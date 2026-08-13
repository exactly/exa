import { captureException, setUser } from "@sentry/node";
import { UnrecoverableError } from "bullmq";
import createDebug from "debug";
import { and, eq } from "drizzle-orm";
import { createHmac } from "node:crypto";
import * as v from "valibot";

import { attempts, name, type Job } from "./job";
import { credentials, transactions } from "../../database/schema";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type createPanda from "../../utils/panda";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

export default function worker({
  bullmq,
  database,
  panda,
}: {
  bullmq: Redis;
  database: NodePgDatabase<typeof schema>;
  panda: ReturnType<typeof createPanda>;
}) {
  return createWorker<Job>({
    attempts,
    bullmq,
    failed(job, error) {
      captureException(error, {
        extra: { attempts: job?.attemptsMade, id: job?.id },
        level: "fatal",
        fingerprint: ["{{ default }}", "hook.exhausted"],
        tags: { queue: name, job: job?.name },
      });
    },
    name,
    async process(job, span) {
      const id = v.parse(v.string(), job.id);
      span.setAttribute("panda.event", id);
      const data = v.safeParse(
        v.object({
          delivered: v.optional(v.array(v.string())),
          receipt: v.optional(v.object({ blockNumber: v.number(), transactionHash: v.string() })),
        }),
        job.data,
      );
      if (!data.success) {
        throw Object.assign(new UnrecoverableError("invalid job data"), { cause: new v.ValiError(data.issues) });
      }
      const { requestBody: payload } = await panda.getWebhook(id);
      if (payload.resource === "transaction" && payload.action === "requested") return;
      if (payload.resource === "application" || payload.resource === "company" || payload.resource === "dispute")
        return;
      if (payload.resource === "card" && payload.action === "notification") return;
      const user = await database.query.credentials.findFirst({
        columns: { account: true, id: true, source: true },
        with: { source: { columns: { config: true } } },
        where: eq(
          credentials.pandaId,
          (() => {
            switch (payload.resource) {
              case "card":
                return payload.body.userId;
              case "user":
                return payload.body.id;
              case "transaction":
                return payload.body.spend.userId;
            }
          })(),
        ),
      });
      if (user) setUser({ id: user.account });
      if (!user?.source) return;
      const config = v.safeParse(Config, user.source.config);
      if (!config.success) {
        throw Object.assign(new UnrecoverableError("invalid config"), { cause: new v.ValiError(config.issues) });
      }
      if (
        payload.resource === "transaction" &&
        payload.action !== "completed" &&
        payload.body.spend.declinedReason?.toLowerCase() === "webhook declined"
      ) {
        const stored = v.safeParse(
          v.object({
            bodies: v.array(
              v.looseObject({
                action: v.string(),
                body: v.looseObject({ spend: v.looseObject({ declinedReason: v.nullish(v.string()) }) }),
                reason: v.optional(v.string()),
              }),
            ),
          }),
          await database.query.transactions
            .findFirst({
              columns: { payload: true },
              where: and(eq(transactions.id, payload.body.id), eq(transactions.cardId, payload.body.spend.cardId)),
            })
            .then((transaction) => transaction?.payload),
        );
        const requested = stored.success
          ? stored.output.bodies.findLast(({ action }) => action === "requested")
          : undefined;
        const reason = requested?.body.spend.declinedReason ?? requested?.reason;
        if (reason) payload.body.spend.declinedReason = reason;
      }
      const timestamp = new Date().toISOString();
      const outbound = v.safeParse(
        Webhook,
        (() => {
          switch (payload.resource) {
            case "user":
              return { ...payload, timestamp, body: { ...payload.body, credentialId: user.id } };
            case "card":
              return {
                ...payload,
                timestamp,
                body: {
                  ...payload.body,
                  status: { active: "ACTIVE", locked: "FROZEN", canceled: "DELETED", notActivated: "INACTIVE" }[
                    payload.body.status
                  ],
                },
              };
            case "transaction":
              return {
                ...payload,
                ...(data.output.receipt && { receipt: data.output.receipt }),
                timestamp,
                ...(payload.action !== "updated" &&
                  payload.body.spend.currency !== payload.body.spend.localCurrency && {
                    body: {
                      ...payload.body,
                      spend: { ...payload.body.spend, exchangeRate: payload.body.spend.exchangeRate },
                    },
                  }),
              };
          }
        })(),
      );
      if (!outbound.success) {
        throw Object.assign(new UnrecoverableError("invalid webhook body"), {
          cause: new v.ValiError(outbound.issues),
        });
      }
      const failures = await Promise.all(
        Object.entries(config.output.webhooks)
          .filter(([key]) => !data.output.delivered?.includes(key))
          .map(async ([key, target]) => {
            try {
              const response = await fetch(
                (() => {
                  switch (payload.resource) {
                    case "user":
                      return target.user?.[payload.action];
                    case "card":
                      return target.card?.[payload.action];
                    case "transaction":
                      return target.transaction?.[payload.action];
                  }
                })() ?? target.url,
                {
                  method: "POST",
                  redirect: "error",
                  headers: {
                    "Content-Type": "application/json",
                    Signature: createHmac("sha256", target.secret)
                      .update(JSON.stringify(outbound.output))
                      .digest("hex"),
                  },
                  body: JSON.stringify(outbound.output),
                  signal: AbortSignal.timeout(60_000),
                },
              );
              if (!response.ok) {
                throw new Error("WebhookFailed", {
                  cause: {
                    code: response.status,
                    response: await response.text().then(parseText),
                    payload: outbound.output,
                  },
                });
              }
              debugWebhook("%j", {
                code: response.status,
                response: await response.text().then(parseText),
                payload: outbound.output,
              });
              return [];
            } catch (error) {
              if (error instanceof Error) {
                if (error.message === "WebhookFailed") {
                  debugWebhook("%j", error.cause);
                } else {
                  debugWebhook("%j", { error: error.message, payload: outbound.output });
                }
              }
              return [{ key, error }];
            }
          }),
      ).then((results) => results.flat());
      if (failures.length > 0) {
        await job.updateData({
          ...job.data,
          delivered: Object.keys(config.output.webhooks).filter(
            (key) => !failures.some((failure) => failure.key === key),
          ),
        });
        throw new AggregateError(
          failures.map(({ error }) => error),
          "webhook failed",
        );
      }
    },
  });
}

function parseText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

const debugWebhook = createDebug("exa:webhook");
Object.assign(debugWebhook, { inspectOpts: { depth: undefined } });

const BaseWebhook = v.object({
  id: v.string(),
  type: v.literal("spend"),
  spend: v.object({
    amount: v.number(),
    currency: v.literal("usd"),
    cardId: v.string(),
    localAmount: v.number(),
    localCurrency: v.pipe(v.string(), v.length(3)),
    merchantCity: v.nullish(v.pipe(v.string(), v.trim())),
    merchantCountry: v.nullish(v.pipe(v.string(), v.trim())),
    merchantCategory: v.nullish(v.pipe(v.string(), v.trim())),
    merchantCategoryCode: v.string(),
    merchantName: v.pipe(v.string(), v.trim()),
    authorizedAt: v.optional(v.pipe(v.string(), v.isoTimestamp())),
    authorizedAmount: v.nullish(v.number()),
    merchantId: v.nullish(v.string()),
  }),
});

const Receipt = v.object({ blockNumber: v.number(), transactionHash: v.string() });

const Webhook = v.variant("resource", [
  v.variant("action", [
    v.object({
      id: v.string(),
      timestamp: v.pipe(v.string(), v.isoTimestamp()),
      resource: v.literal("transaction"),
      action: v.literal("created"),
      receipt: v.optional(Receipt),
      body: v.object({
        ...BaseWebhook.entries,
        spend: v.object({
          ...BaseWebhook.entries.spend.entries,
          status: v.picklist(["pending", "declined"]),
          declinedReason: v.nullish(v.string()),
          exchangeRate: v.optional(v.number()),
        }),
      }),
    }),
    v.object({
      id: v.string(),
      timestamp: v.pipe(v.string(), v.isoTimestamp()),
      resource: v.literal("transaction"),
      action: v.literal("updated"),
      receipt: v.optional(Receipt),
      body: v.object({
        ...BaseWebhook.entries,
        spend: v.object({
          ...BaseWebhook.entries.spend.entries,
          authorizationUpdateAmount: v.number(),
          authorizedAt: v.pipe(v.string(), v.isoTimestamp()),
          status: v.picklist(["declined", "pending", "reversed"]),
          declinedReason: v.nullish(v.string()),
          enrichedMerchantIcon: v.nullish(v.string()),
          enrichedMerchantName: v.nullish(v.string()),
          enrichedMerchantCategory: v.nullish(v.string()),
        }),
      }),
    }),
    v.object({
      id: v.string(),
      timestamp: v.pipe(v.string(), v.isoTimestamp()),
      resource: v.literal("transaction"),
      action: v.literal("completed"),
      receipt: v.optional(Receipt),
      body: v.object({
        ...BaseWebhook.entries,
        spend: v.object({
          ...BaseWebhook.entries.spend.entries,
          authorizedAt: v.pipe(v.string(), v.isoTimestamp()),
          status: v.literal("completed"),
          enrichedMerchantIcon: v.nullish(v.string()),
          enrichedMerchantName: v.nullish(v.string()),
          enrichedMerchantCategory: v.nullish(v.string()),
          exchangeRate: v.optional(v.number()),
        }),
      }),
    }),
  ]),
  v.object({
    id: v.string(),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    resource: v.literal("card"),
    action: v.literal("updated"),
    body: v.object({
      id: v.string(),
      last4: v.pipe(v.string(), v.length(4)),
      limit: v.object({
        amount: v.number(),
        frequency: v.picklist(["per24HourPeriod", "per7DayPeriod", "per30DayPeriod", "perYearPeriod"]),
      }),
      status: v.picklist(["ACTIVE", "FROZEN", "DELETED", "INACTIVE"]),
      tokenWallets: v.nullish(v.union([v.array(v.literal("Apple")), v.array(v.literal("Google Pay"))])),
    }),
  }),
  v.object({
    id: v.string(),
    timestamp: v.pipe(v.string(), v.isoTimestamp()),
    resource: v.literal("user"),
    action: v.literal("updated"),
    body: v.object({
      credentialId: v.string(),
      applicationReason: v.string(),
      applicationStatus: v.picklist([
        "approved",
        "pending",
        "needsInformation",
        "needsVerification",
        "manualReview",
        "denied",
        "locked",
        "canceled",
      ]),
      isActive: v.boolean(),
    }),
  }),
]);

const Config = v.object({
  type: v.picklist(["integrator", "uphold"]),
  webhooks: v.record(
    v.string(),
    v.object({
      url: v.string(),
      secret: v.string(),
      transaction: v.optional(
        v.object({
          created: v.optional(v.string()),
          updated: v.optional(v.string()),
          completed: v.optional(v.string()),
        }),
      ),
      card: v.optional(v.object({ updated: v.optional(v.string()) })),
      user: v.optional(v.object({ updated: v.optional(v.string()) })),
    }),
  ),
});
