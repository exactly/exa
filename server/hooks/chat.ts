import { vValidator } from "@hono/valibot-validator";
import { Mastra } from "@mastra/core";
import { Agent } from "@mastra/core/agent";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { Observability } from "@mastra/observability";
import { SentryExporter } from "@mastra/sentry";
import { captureException } from "@sentry/node";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";

import { config } from "../instrument.cjs";
import validatorHook from "../utils/validatorHook";

export default function chat({
  googleKey,
  whatsappKey,
  whatsappSecret,
  whatsappUrl,
}: {
  googleKey: string;
  whatsappKey: string;
  whatsappSecret?: string;
  whatsappUrl?: string;
}) {
  const whatsapp = kapso({ apiKey: whatsappKey, url: whatsappUrl, webhookSecret: whatsappSecret });
  const agent = assistant(googleKey);
  const mastra = new Mastra({
    agents: { assistant: agent },
    workflows: { reply: reply(agent) },
    observability: new Observability({
      configs: {
        default: {
          serviceName: "chat",
          exporters: [
            new SentryExporter({
              dsn: config.dsn,
              environment: config.environment,
              release: config.release,
              tracesSampleRate: config.tracesSampleRate,
              options: config,
            }),
          ],
        },
      },
    }),
  });
  const app = new Hono().post(
    "/",
    validator("header", async ({ "x-webhook-signature": signature }, c) => {
      if (!whatsapp.verify(await c.req.text(), signature)) return c.json({ code: "invalid signature" }, 401);
    }),
    vValidator("json", v.union([event, v.array(event)]), validatorHook({ code: "bad chat" })),
    async (c) => {
      const payload = c.req.valid("json");
      // TODO dedupe whatsapp message ids across deliveries, this map only covers a single batch
      const messages = new Map(
        (Array.isArray(payload) ? payload : [payload])
          .map((item) => whatsapp.parse(item))
          .filter((message) => message !== undefined)
          .map((message) => [message.id, message] as const),
      );
      await Promise.allSettled(
        [...Map.groupBy(messages.values(), ({ from, phoneNumberId }) => `${phoneNumberId}/${from}`).values()].map(
          async (thread) => {
            const [first] = thread;
            if (!first) return;

            await mastra
              .getWorkflow("reply")
              .createRun()
              .then((run) =>
                run.start({
                  inputData: {
                    from: first.from,
                    text: thread.map(({ text }) => text).join("\n"),
                    contact: first.contact,
                  },
                }),
              )
              .then((result) => {
                if (result.status !== "success") {
                  const error = new Error(`reply workflow ${result.status}`);
                  captureException(error, { extra: { result, from: first.from } });
                  throw error;
                }
                return whatsapp.send(first.phoneNumberId, first.from, v.parse(answer, result.result).reply);
              });
          },
        ),
      ).then((threads) => {
        if (threads.some((thread) => thread.status === "rejected")) throw new Error("chat delivery failed");
      });
      return c.json({ code: "ok" });
    },
  );
  return {
    app,
    close() {
      return mastra.shutdown();
    },
    ready: Promise.resolve(),
  };
}

export function assistant(apiKey: string, model: `${string}/${string}` = "google/gemini-flash-latest") {
  return new Agent({
    id: "assistant",
    name: "Exa Assistant",
    instructions: [
      "You are Exa's assistant on WhatsApp.",
      "Exa is a self-custodial finance app that combines a card, a crypto wallet, and a DeFi protocol so people can spend, save, and borrow onchain from a single place.",
      "Reply like a helpful human agent over WhatsApp: warm, concise, one or two short paragraphs, plain text with no markdown.",
      "Always answer in the same language the user wrote in.",
      "You cannot see the user's account, balances, or transactions, so never invent them; when a request needs account data or an action you cannot perform, say a teammate will follow up.",
      "Never give financial, legal, or tax advice, and never ask for seed phrases, passwords, or card numbers.",
    ].join(" "),
    model: { id: model, apiKey },
  });
}

export function reply(agent: Agent) {
  return createWorkflow({
    id: "reply",
    inputSchema: toStandardJsonSchema(inbound),
    outputSchema: toStandardJsonSchema(answer),
  })
    .then(
      createStep({
        id: "compose",
        inputSchema: toStandardJsonSchema(inbound),
        outputSchema: toStandardJsonSchema(prompt),
        execute: ({ inputData }) =>
          Promise.resolve({
            prompt: `WhatsApp message from ${inputData.contact ?? inputData.from} (+${inputData.from}):\n\n${inputData.text}`,
          }),
      }),
    )
    .then(
      createStep({
        id: "respond",
        inputSchema: toStandardJsonSchema(prompt),
        outputSchema: toStandardJsonSchema(answer),
        execute: ({ inputData }) => agent.generate(inputData.prompt).then(({ text }) => ({ reply: text })),
      }),
    )
    .commit();
}

const inbound = v.object({ from: v.string(), text: v.string(), contact: v.optional(v.string()) });
const prompt = v.object({ prompt: v.string() });
const answer = v.object({ reply: v.string() });

// TODO replace kapso with direct whatsapp api
function kapso({ apiKey, url, webhookSecret }: { apiKey: string; url?: string; webhookSecret?: string }) {
  const apiUrl = url ?? "https://api.kapso.ai";
  const headers = { "X-API-Key": apiKey, "content-type": "application/json" };
  return {
    verify(body: string, signature?: string) {
      if (!webhookSecret) return true;
      if (!signature) return false;
      const expected = Buffer.from(createHmac("sha256", webhookSecret).update(body).digest("hex"));
      const received = Buffer.from(signature);
      return received.length === expected.length && timingSafeEqual(received, expected);
    },

    parse({ message, conversation, phone_number_id }: v.InferOutput<typeof event>) {
      const text = message.text?.body ?? message.kapso?.content ?? "";
      if (!text) return;
      return {
        id: message.id,
        from: message.from,
        text,
        contact: conversation?.kapso?.contact_name,
        phoneNumberId: phone_number_id,
      };
    },

    async send(from: string, to: string, text: string) {
      const response = await fetch(`${apiUrl}/meta/whatsapp/v24.0/${from}/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
      });
      if (!response.ok) throw new Error(`kapso send failed ${response.status}: ${await response.text()}`);
    },
  };
}

const event = v.object({
  message: v.object({
    id: v.string(),
    from: v.string(),
    type: v.string(),
    text: v.optional(v.object({ body: v.string() })),
    kapso: v.optional(v.object({ content: v.optional(v.string()) })),
  }),
  conversation: v.optional(v.object({ kapso: v.optional(v.object({ contact_name: v.optional(v.string()) })) })),
  phone_number_id: v.string(),
});
