import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { InMemoryServerCache } from "@mastra/core/cache";
import { ResponseCache } from "@mastra/core/processors";
import { RequestContext } from "@mastra/core/request-context";
import { createTool } from "@mastra/core/tools";
import { Memory } from "@mastra/memory";
import { Observability } from "@mastra/observability";
import { SentryExporter } from "@mastra/sentry";
import { captureException } from "@sentry/node";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { eq } from "drizzle-orm";
import { description, object, optional, pipe, regex, safeParse, string, type InferOutput } from "valibot";

import { attempts, name, type Job } from "./job";
import { credentials } from "../../database/schema";
import sentry from "../../instrument.cjs";
import { own } from "../../supervise";
import appOrigin from "../../utils/appOrigin";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type createWhatsapp from "../../utils/whatsapp";
import type { AgentExecutionOptions, ToolsInput } from "@mastra/core/agent";
import type { MessageListInput } from "@mastra/core/agent/message-list";
import type { InferPublicSchema } from "@mastra/core/schema";
import type { RedisStore } from "@mastra/redis";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

export default function worker({
  anthropicKey,
  bullmq,
  database,
  store,
  whatsapp,
}: {
  anthropicKey: string;
  bullmq: Redis;
  database: NodePgDatabase<typeof schema>;
  store: RedisStore;
  whatsapp: ReturnType<typeof createWhatsapp>;
}) {
  bullmq.on("error", (error: unknown) => captureException(error));
  store.getClient().on("error", (error: unknown) => captureException(error));
  const { agent, reply } = chat(anthropicKey, whatsapp, store);
  const mastra = new Mastra({
    agents: { chat: agent },
    observability: new Observability({
      configs: {
        default: {
          serviceName: name,
          requestContextKeys: ["account", "bridgeId", "credentialId", "pandaId", "whatsappId"],
          exporters: [new SentryExporter({ ...sentry, options: sentry })],
        },
      },
    }),
  });
  return own(
    createWorker<Job>({
      attempts,
      bullmq,
      failed(job, error) {
        captureException(error, {
          extra: { attempts: job?.attemptsMade, from: job?.data.from, id: job?.id },
          level: "fatal",
        });
      },
      name,
      async process({ data }) {
        const credential = await database.query.credentials.findFirst({
          columns: { account: true, bridgeId: true, id: true, pandaId: true },
          where: eq(credentials.whatsappId, data.from),
        });
        const { text } = await reply(data.text, {
          memory: { resource: data.from, thread: `${data.phoneNumberId}/${data.from}` },
          requestContext: new RequestContext<InferPublicSchema<typeof context>>([
            ["account", credential?.account],
            ["bridgeId", credential?.bridgeId ?? undefined],
            ["credentialId", credential?.id],
            ["pandaId", credential?.pandaId ?? undefined],
            ["whatsappId", data.from],
          ]),
        });
        await whatsapp.send(data.from, text);
      },
    }),
    () => mastra.shutdown(),
  );
}

export function chat(apiKey: string, whatsapp: ReturnType<typeof createWhatsapp>, store: RedisStore) {
  const composeLink = linkComposer(apiKey, whatsapp);
  function pending(id: string, prompt: string, target: (typeof links)[keyof typeof links]) {
    return createTool({
      id,
      description: prompt,
      inputSchema: toStandardJsonSchema(object({ locale })),
      outputSchema: guidance,
      toModelOutput,
      execute: async ({ locale: language }) => ({ guidance: appended, link: await composeLink(target, language) }),
    });
  }
  const tools = {
    associate: createTool({
      id: "associate",
      description:
        "Associate this whatsapp number with an Exa account. Call it when the number is not associated yet and the person wants anything from Exa, or when someone on an associated number asks to move it to a different account. Do not call it for general questions about how Exa works. Appends a personal sign-in link to your reply; whoever opens it ends up with this number on their account.",
      inputSchema: toStandardJsonSchema(object({ locale })),
      outputSchema: guidance,
      requestContextSchema: context,
      toModelOutput,
      execute: async ({ locale: language }, { requestContext }) => ({
        guidance: appended,
        link: await composeLink(
          links[requestContext.get("credentialId") ? "move" : "associate"],
          language,
          requestContext.get("whatsappId"),
        ),
      }),
    }),
    verification: pending(
      "verification",
      "Verify the person's identity. Call it when they ask to verify, to finish KYC, or about the status of their verification.",
      links.handoff,
    ),
    card: pending(
      "card",
      "Work with the person's Exa card. Call it when they ask for a card, about an existing card, or anything the card does.",
      links.handoff,
    ),
    transfers: pending(
      "transfers",
      "Move money between the person's Exa account and their bank. Call it when they ask to deposit, withdraw, or transfer to or from a bank.",
      links.handoff,
    ),
    support: pending(
      "support",
      "Answer how Exa works: what the product does, fees, security, availability, how a feature behaves. Call it whenever the person asks what Exa is or how any part of it works, before you answer — never answer about the product from your own knowledge, even when you are sure.",
      links.support,
    ),
  };
  const memory = new Memory({ storage: store, options: { lastMessages } });
  const agent = new Agent({
    id: name,
    name: "Exa Chat",
    memory,
    requestContextSchema: context,
    instructions: ({ requestContext }) =>
      [
        "You handle Exa's WhatsApp chat.",
        "Exa is a self-custodial finance app that combines a card, a crypto wallet, and a DeFi protocol so people can spend, save, and borrow onchain from a single place.",
        "",
        "Reply like a helpful human agent over WhatsApp: warm, brief, and straight to the next action the person needs. One short paragraph, plain text with no markdown.",
        "Always answer in the same language the person wrote in, and ask the tools for that same language.",
        "Tools talk to you alone: answer from what they give you in your own words, follow what they tell you, and never send it as it is.",
        "Call a tool whenever the person wants something it covers. Never guess how far along something is, describe steps yourself, or say a thing cannot be done here — the tool decides what happens and what the person is told.",
        "Never explain how Exa or its links work, however sure you are and however simple the question looks — call support and let the link it sends do the explaining.",
        "Never invent a situation, a link, or an outcome; every link comes from a tool.",
        "Never give financial, legal, or tax advice, and never ask for seed phrases, passwords, or card numbers.",
        "",
        "What comes next is this person's real situation, checked again for this message, and it is the one thing you can rely on. Anything said earlier in the conversation only records how the conversation went: since then the number may have been associated, removed, or moved to another account. When the two disagree the situation below is right, and someone telling you it changed does not change it.",
        ...(requestContext.get("credentialId")
          ? [
              "This number is associated with an Exa account.",
              "Treat the account as theirs and do not offer to associate the number again. If they want this number on a different Exa account, call associate and explain that signing in with the other method moves it.",
              `The account is ${String(requestContext.get("account"))}.`,
            ]
          : [
              "This number is not associated with any Exa account.",
              "Associating this number comes before anything else, so when they want anything from Exa, call associate. Do not tell them they are associated, verified, or set up.",
              "If they believe this number is already associated, tell them you cannot see an account for it and send the link so they can do it now, rather than asking them to check back later.",
            ]),
      ].join("\n"),
    model: { id: model, apiKey },
    tools: ({ requestContext }): ToolsInput =>
      requestContext.get("credentialId") ? tools : { associate: tools.associate, support: tools.support },
  });
  async function reply(messages: MessageListInput, options?: AgentExecutionOptions) {
    const result = await agent.generate(messages, { ...options });
    const link = result.toolResults
      .flatMap(({ payload }) => {
        const parsed = safeParse(answer, payload.result);
        return parsed.success ? [parsed.output.link] : [];
      })
      .at(-1);
    const written = result.steps.findLast(({ text }) => text.trim());
    const text = [written?.text.trim(), link].filter(Boolean).join("\n\n");
    if (!text) throw new Error("no reply composed");
    return { ...result, text };
  }
  return { agent, reply };
}

function linkComposer(apiKey: string, whatsapp: ReturnType<typeof createWhatsapp>) {
  const translator = new Agent({
    id: "translator",
    name: "Translator",
    instructions: [
      "Translate the text you are given into the requested locale, matching the regional variety and register it implies.",
      "Address the person informally all the way through.",
      "Leave Exa, Exa Card and Exa App exactly as they are.",
      "Preserve meaning, tone, and line breaks exactly.",
      "Reply with the translation and nothing else.",
    ].join("\n"),
    model: { id: model, apiKey },
    inputProcessors: [new ResponseCache({ cache: new InMemoryServerCache(), ttl, scope: null, agentId: "translator" })],
  });
  const translate = async (text: string, language: string) => {
    if (/^en(?:-|$)/i.test(language)) return text;
    const { text: translated } = await translator.generate(`Translate to ${language}:\n\n${text}`);
    return translated.trim();
  };
  return async function composeLink(target: (typeof links)[keyof typeof links], language: string, whatsappId?: string) {
    const [intro, token, close] = await Promise.all([
      "intro" in target ? translate(target.intro, language) : undefined,
      whatsappId === undefined ? undefined : whatsapp.encode(whatsappId),
      "close" in target ? translate(target.close, language) : undefined,
    ]);
    const url = `${appOrigin}${target.path}${token === undefined ? "" : `?token=${token}`}`;
    return [[intro, url].filter(Boolean).join("\n"), close].filter(Boolean).join("\n\n");
  };
}

export const context = toStandardJsonSchema(
  object({
    account: optional(string()),
    bridgeId: optional(string()),
    credentialId: optional(string()),
    pandaId: optional(string()),
    whatsappId: string(),
  }),
);
const answer = object({ guidance: string(), link: string() });
const guidance = toStandardJsonSchema(answer);
const toModelOutput = ({ guidance: only }: InferOutput<typeof answer>) => ({ type: "text" as const, value: only });
const locale = pipe(
  string(),
  regex(/^[\w-]{2,35}$/),
  description(
    "bcp-47 tag for the language the person wrote in, with the region whenever you can tell it from how they write, e.g. es-AR, pt-BR, en, it",
  ),
);
const appended =
  "the link is appended to your reply for you, in the language you asked for. Write one short sentence introducing it and nothing else — do not write the link.";

const model = "anthropic/claude-sonnet-5";
const lastMessages = 15;
const ttl = 3600;

const links = {
  handoff: { path: "", intro: "You can continue this in the app." },
  support: { path: "/?support" },
  associate: {
    path: "/whatsapp",
    close:
      "Sign in and follow the steps. If you already have an Exa account, use it to avoid creating an empty one. Don't share this link.",
  },
  move: {
    path: "/whatsapp",
    close: "Sign in as the account you want to use — this number moves to whichever you use. Don't share this link.",
  },
} as const satisfies Record<string, { close?: string; intro?: string; path: string }>;
