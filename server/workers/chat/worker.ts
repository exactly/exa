import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { InMemoryServerCache } from "@mastra/core/cache";
import { ResponseCache } from "@mastra/core/processors";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { Observability } from "@mastra/observability";
import { SentryExporter } from "@mastra/sentry";
import { captureException } from "@sentry/node";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";

import { attempts, name, type Job } from "./job";
import sentry from "../../instrument.cjs";
import appOrigin from "../../utils/appOrigin";
import ServiceError from "../../utils/ServiceError";
import createWorker from "../worker";

import type { AgentExecutionOptions, ToolsInput } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { InferPublicSchema } from "@mastra/core/schema";
import type { Redis } from "ioredis";

export default function chat({
  anthropicKey,
  bullmq,
  close,
  whatsappFrom,
  whatsappToken,
}: {
  anthropicKey: string;
  bullmq: Redis;
  close?: () => Promise<unknown>;
  whatsappFrom: string;
  whatsappToken: string;
}) {
  bullmq.on("error", (error: unknown) => captureException(error));
  const { agent, reply } = compose(anthropicKey);
  const mastra = new Mastra({
    agents: { chat: agent },
    observability: new Observability({
      configs: {
        default: {
          serviceName: name,
          requestContextKeys: ["seen"],
          exporters: [new SentryExporter({ ...sentry, options: sentry })],
        },
      },
    }),
  });
  return createWorker<Job>({
    attempts,
    bullmq,
    close: () => mastra.shutdown().finally(() => close?.()),
    failed(job, error) {
      captureException(error, {
        extra: { attempts: job?.attemptsMade, from: job?.data.from, id: job?.id },
        level: "fatal",
      });
    },
    name,
    async process({ data, id }) {
      const seen = await bullmq.exists(`whatsapp:seen:${data.from}`);
      const { text } = await reply(data.text, {
        requestContext: new RequestContext<InferPublicSchema<typeof context>>([["seen", seen === 1]]),
      });
      const response = await fetch(`https://graph.facebook.com/v26.0/${whatsappFrom}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${whatsappToken}`,
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          recipient: data.from,
          type: "text",
          text: { body: text },
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new ServiceError("WhatsApp", response.status, await response.text());
      await bullmq.set(`whatsapp:seen:${data.from}`, v.parse(v.string(), id), "NX");
    },
  });
}

export function compose(apiKey: string) {
  const translator = new Agent({
    id: "translator",
    name: "Translator",
    instructions: [
      "Translate the text you are given into the requested locale, matching the regional variety it implies.",
      "Address the person informally all the way through.",
      "Leave Exa, Exa Card and Exa App exactly as they are.",
      "Preserve meaning, tone, and line breaks exactly.",
      "Reply with the translation and nothing else.",
    ].join("\n"),
    model: { id: model, apiKey },
    inputProcessors: [new ResponseCache({ cache: new InMemoryServerCache(), ttl, scope: null, agentId: "translator" })],
  });
  const speak = (id: keyof typeof scripts) =>
    createTool({
      id,
      description: scripts[id].description,
      inputSchema: toStandardJsonSchema(v.object({ locale })),
      outputSchema: toStandardJsonSchema(answer),
      execute: ({ locale: language }) =>
        Promise.all(
          scripts[id].blocks.map(async ({ text, url }) =>
            [
              language === "en" || language.startsWith("en-")
                ? text
                : await translator
                    .generate(`Translate to ${language}:\n\n${text}`)
                    .then(({ text: translated }) => translated.trim()),
              url,
            ].join(" "),
          ),
        ).then((blocks) => ({ text: blocks.join("\n") })),
    });
  const tools = { help: speak("help"), welcome: speak("welcome") };
  const agent = new Agent({
    id: name,
    name: "Exa Chat",
    requestContextSchema: context,
    instructions: ({ requestContext }) =>
      [
        "You handle Exa's WhatsApp chat.",
        `Answer by calling ${requestContext.get("seen") ? "help" : "welcome"} and nothing else.`,
      ].join("\n"),
    model: { id: model, apiKey },
    tools: ({ requestContext }): ToolsInput =>
      requestContext.get("seen") ? { help: tools.help } : { welcome: tools.welcome },
  });
  async function reply(messages: MessageListInput, options?: AgentExecutionOptions) {
    const result = await agent.generate(messages, { ...options, maxSteps: 1, toolChoice: "required" });
    const script = result.toolResults
      .flatMap(({ payload }) => {
        const parsed = v.safeParse(answer, payload.result);
        return parsed.success ? [parsed.output.text] : [];
      })
      .at(-1);
    if (!script) throw new Error("no script composed");
    return { ...result, text: script };
  }
  return { agent, reply };
}

export const context = toStandardJsonSchema(v.object({ seen: v.boolean() }));
const answer = v.object({ text: v.string() });
const locale = v.pipe(
  v.string(),
  v.regex(/^[\w-]{2,35}$/),
  v.description(
    "bcp-47 tag for the language the person wrote in, with the region whenever you can tell it from how they write, e.g. es-AR, pt-BR, en, it",
  ),
);

const model = "anthropic/claude-sonnet-5";
const ttl = 3600;

const scripts = {
  help: {
    description: "Point someone who already wrote before to the help center and to support.",
    blocks: [
      {
        text: [
          "Hi again. Almost everything you need to know about the Exa Card is in our help center: credit limit, identity verification, billing address, installments and payments.",
          "Search for your topic here:",
        ].join("\n"),
        url: "https://help.exactly.app",
      },
      {
        text: "If you don't find the answer there, write to us from the support chat inside the Exa app:",
        url: `${appOrigin}/support`,
      },
    ],
  },
  welcome: {
    description: "Greet someone writing for the first time and send them to create their account.",
    blocks: [
      {
        text: [
          "Hi, welcome to Exa!",
          "With Exa you choose whether to pay for your purchases instantly with your balance or in fixed-rate installments, without selling your digital assets.",
          "You also get access to a dollar account in the US, all 100% free.",
          "Create your account and activate your card here:",
        ].join("\n"),
        url: appOrigin,
      },
    ],
  },
} as const satisfies Record<string, { blocks: { text: string; url: string }[]; description: string }>;
