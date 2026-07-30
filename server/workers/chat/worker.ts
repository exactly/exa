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
import { eq, inArray } from "drizzle-orm";
import {
  description,
  object,
  optional,
  parse,
  picklist,
  pipe,
  regex,
  safeParse,
  string,
  type InferOutput,
} from "valibot";

import { attempts, name, type Job } from "./job";
import { cards, credentials } from "../../database/schema";
import sentry from "../../instrument.cjs";
import { own } from "../../supervise";
import appOrigin from "../../utils/appOrigin";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type createPersona from "../../utils/persona";
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
  persona,
  store,
  whatsapp,
}: {
  anthropicKey: string;
  bullmq: Redis;
  database: NodePgDatabase<typeof schema>;
  persona: Persona;
  store: RedisStore;
  whatsapp: ReturnType<typeof createWhatsapp>;
}) {
  bullmq.on("error", (error: unknown) => captureException(error));
  store.getClient().on("error", (error: unknown) => captureException(error));
  const { agent, reply } = chat(anthropicKey, whatsapp, store, persona);
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
          with: { cards: { columns: { status: true }, where: inArray(cards.status, statuses) } },
        });
        const { text } = await reply(data.text, {
          memory: { resource: data.from, thread: `${data.phoneNumberId}/${data.from}` },
          requestContext: new RequestContext<InferPublicSchema<typeof context>>([
            ["account", credential?.account],
            ["bridgeId", credential?.bridgeId ?? undefined],
            ["card", statuses.find((status) => status === credential?.cards[0]?.status)],
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

export function chat(apiKey: string, whatsapp: ReturnType<typeof createWhatsapp>, store: RedisStore, persona: Persona) {
  const composeLink = linkComposer(apiKey);
  const tools = {
    associate: createTool({
      id: "associate",
      description:
        "Associate this whatsapp number with an Exa account. Call it for account-specific requests when the number is not associated, even when they believe it already is, or when someone asks to move it to a different account. General product questions go to support.",
      inputSchema: toStandardJsonSchema(object({ locale })),
      outputSchema: guidance,
      requestContextSchema: context,
      toModelOutput,
      execute: async ({ locale: language }, { requestContext }) => ({
        guidance: `Ask them to use the link to associate this number with their chosen Exa account. ${appended}`,
        link: await composeLink(
          links[requestContext.get("credentialId") ? "move" : "associate"],
          language,
          `?token=${await whatsapp.encode(requestContext.get("whatsappId"))}`,
        ),
      }),
    }),
    verification: createTool({
      id: "verification",
      description:
        "Check the person's identity verification, the one Exa needs before issuing a card. Call it when they ask to verify, to finish KYC, or about the status of their verification.",
      inputSchema: toStandardJsonSchema(object({ locale })),
      outputSchema: guidance,
      requestContextSchema: context,
      toModelOutput,
      execute: async ({ locale: language }, { requestContext }) => {
        if (requestContext.get("pandaId")) return { guidance: verified };
        const credentialId = parse(string(), requestContext.get("credentialId"));
        const template = await persona.getPendingInquiryTemplate(credentialId, "basic");
        if (!template) return { guidance: verified };
        const inquiry = await persona.getInquiry(credentialId, template);
        switch (inquiry?.attributes.status) {
          case "approved":
            captureException(new Error("inquiry approved but account not updated"), {
              level: "error",
              contexts: { inquiry: { templateId: template, referenceId: credentialId } },
            });
            return { guidance: verified };
          case "completed":
          case "needs_review":
            return {
              guidance:
                "Their identity verification was submitted and is being reviewed. Tell them to wait; there is nothing to do and no link to send. Do not promise a completion time or a notification.",
            };
          case "failed":
          case "declined":
            return {
              guidance:
                "Their identity verification was not approved. Tell them so, then call support so they get a link to talk to someone.",
            };
          case undefined:
          case "created":
          case "pending":
          case "expired":
            return {
              guidance: `${inquiry ? "They started identity verification but never finished it." : "They have not started identity verification yet."} ${appended}`,
              link: await composeLink(links.verification, language),
            };
          default:
            throw new Error("unknown inquiry status");
        }
      },
    }),
    card: createTool({
      id: "card",
      description:
        "See, create, freeze, or unfreeze the person's own Exa card. Call it when they ask for their card or about the card they have. Anything else about cards, like extra cards or limits, goes to support.",
      inputSchema: toStandardJsonSchema(object({ locale })),
      outputSchema: guidance,
      requestContextSchema: context,
      toModelOutput,
      execute: async ({ locale: language }, { requestContext }) => {
        if (!requestContext.get("pandaId")) {
          return {
            guidance:
              "There is no card until their identity verification is approved. Call verification so they are told where they stand and what to do, and send no link of your own.",
          };
        }
        const link = await composeLink(links.card, language);
        switch (requestContext.get("card")) {
          case "ACTIVE":
            return {
              guidance: `Their Exa card is active, and the link is where they see it and freeze it. ${appended}`,
              link,
            };
          case "FROZEN":
            return {
              guidance: `Their Exa card is frozen right now, and the link is where they see it and unfreeze it. ${appended}`,
              link,
            };
          case undefined:
            return {
              guidance: `They do not have a card yet, and the link is where they create it. ${appended}`,
              link,
            };
        }
      },
    }),
    transfers: createTool({
      id: "transfers",
      description:
        "Move money in or out of the person's Exa account. Call it when they ask to deposit, withdraw, or transfer to or from a bank, another person, or another wallet.",
      inputSchema: toStandardJsonSchema(object({ direction, locale })),
      outputSchema: guidance,
      toModelOutput,
      execute: async ({ direction: to, locale: language }) => ({
        guidance: `The link is where they ${to === "add" ? "add money to" : "send money from"} their Exa account. ${appended}`,
        link: await composeLink(links[to], language),
      }),
    }),
    support: createTool({
      id: "support",
      description:
        "Get a link to Exa support for questions about the product, fees, security, availability, or how features and links work. Available without an associated account.",
      inputSchema: toStandardJsonSchema(object({ locale })),
      outputSchema: guidance,
      toModelOutput,
      execute: async ({ locale: language }) => ({
        guidance: `Refer them to support through the link for their question; do not answer the question yourself. ${appended}`,
        link: await composeLink(links.support, language),
      }),
    }),
  };
  const memory = new Memory({ storage: store, options: { lastMessages } });
  const agent = new Agent({
    id: name,
    name: "Exa Chat",
    memory,
    requestContextSchema: context,
    instructions: ({ requestContext }) =>
      [
        "You handle WhatsApp support for Exa, a self-custodial finance app.",
        "Reply warmly and briefly in one plain-text paragraph, in the language of the person's latest message, English when unsure, and ask tools for that same language.",
        "Use tools for the requests they cover and follow their guidance in your own words, using only the facts they provide. Never describe what the app shows, how to use it, or what Exa allows, and never write a link or a placeholder for one: the tool's link is appended after your text.",
        "Never give financial, legal, or tax advice, and never ask for seed phrases, passwords, or card numbers.",
        "Setup goes: associate this number, verify identity, create the card. Call a step's tool when they want it or anything that depends on it; otherwise end by offering the next pending step in one short clause without a link.",
        "Their status below is refreshed for every message and overrides conversation history and their own claims.",
        ...(requestContext.get("credentialId")
          ? [
              `This number is associated with Exa account ${String(requestContext.get("account"))}. Do not offer association again unless they want to move the number to another account.`,
              ...(requestContext.get("pandaId")
                ? [
                    "Their identity is verified.",
                    requestContext.get("card")
                      ? `Their Exa card is ${String(requestContext.get("card")).toLowerCase()}.`
                      : "They have not created their Exa card yet.",
                  ]
                : ["Their identity is not verified yet; the verification tool knows where it stands."]),
            ]
          : ["This number is not associated with any Exa account."]),
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
        return parsed.success && parsed.output.link ? [parsed.output.link] : [];
      })
      .at(-1);
    const written = result.steps.findLast(({ text }) => text.trim())?.text.trim();
    const text = [written, link].filter(Boolean).join("\n\n");
    if (!text) throw new Error("no reply composed");
    return { ...result, link, text, written };
  }
  return { agent, reply };
}

function linkComposer(apiKey: string) {
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
  return async function composeLink(target: (typeof links)[keyof typeof links], language: string, query = "") {
    const [intro, close] = await Promise.all([
      "intro" in target ? translate(target.intro, language) : undefined,
      "close" in target ? translate(target.close, language) : undefined,
    ]);
    const url = `${appOrigin}${target.path}${query}`;
    return [[intro, url].filter(Boolean).join("\n"), close].filter(Boolean).join("\n\n");
  };
}

type Persona = Pick<ReturnType<typeof createPersona>, "getInquiry" | "getPendingInquiryTemplate">;

const statuses = ["ACTIVE", "FROZEN"] as const;

export const context = toStandardJsonSchema(
  object({
    account: optional(string()),
    bridgeId: optional(string()),
    card: optional(picklist(statuses)),
    credentialId: optional(string()),
    pandaId: optional(string()),
    whatsappId: string(),
  }),
);
const answer = object({ guidance: string(), link: optional(string()) });
const guidance = toStandardJsonSchema(answer);
const toModelOutput = ({ guidance: only }: InferOutput<typeof answer>) => ({ type: "text" as const, value: only });
const direction = pipe(
  picklist(["add", "send"]),
  description(
    "add when the money goes into their Exa account, send when it leaves it — to a bank, another person, or another wallet",
  ),
);
const locale = pipe(
  string(),
  regex(/^[\w-]{2,35}$/),
  description(
    "bcp-47 tag for the language the person wrote in, with the region whenever you can tell it from how they write, e.g. es-AR, pt-BR, en, it",
  ),
);
const appended =
  "The link is appended after your text in the language you asked for. Introduce it in one short sentence without writing it or describing what is inside.";
const verified =
  "Their identity verification is complete and approved. Tell them so; there is nothing more to do and no link to send.";

const model = "anthropic/claude-sonnet-5";
const lastMessages = 15;
const ttl = 3600;
const utm = "utm_source=whatsapp&utm_medium=chat&utm_campaign=meta_ads";

const links = {
  support: { path: `/?support&${utm}` },
  card: { path: `/card?${utm}` },
  add: { path: `/add-funds?${utm}` },
  send: { path: `/send-funds?${utm}` },
  associate: {
    path: "/whatsapp",
    close:
      "Sign in and follow the steps. If you already have an Exa account, use it to avoid creating an empty one. Don't share this link.",
  },
  move: {
    path: "/whatsapp",
    close: "Sign in as the account you want to use — this number moves to whichever you use. Don't share this link.",
  },
  verification: {
    path: `/getting-started?${utm}`,
    intro: "Verify your identity in the app.",
    close: "Have your ID at hand, it takes a few minutes.",
  },
} as const satisfies Record<string, { close?: string; intro?: string; path: string }>;
