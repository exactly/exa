import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import {
  captureException,
  continueTrace,
  getActiveSpan,
  setUser,
  spanToBaggageHeader,
  spanToTraceHeader,
  startSpan,
  withScope,
} from "@sentry/node";
import { Queue, Worker } from "bullmq";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { hexToBytes, isAddress } from "viem";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { addWebhookAddresses } from "./alchemy";
import authSecret from "./authSecret";
import decodePublicKey from "./decodePublicKey";
import { queue as redisConnection } from "./redis";
import { customer } from "./sardine";
import { identify } from "./segment";
import database from "../database";
import { credentials } from "../database/schema";
import { webhookId } from "../hooks/activity";

import type { WebAuthnCredential } from "@simplewebauthn/server";
import type { Context } from "hono";

export default async function createCredential<C extends string>(
  c: Context,
  credentialId: C,
  options?: { source?: string; webauthn?: WebAuthnCredential },
) {
  const publicKey =
    options?.webauthn?.publicKey ?? (isAddress(credentialId) ? new Uint8Array(hexToBytes(credentialId)) : undefined);
  if (!publicKey) throw new Error("bad credential");
  const { x, y } = decodePublicKey(publicKey);
  const account = deriveAddress(exaAccountFactoryAddress, { x, y });

  setUser({ id: account });
  const expires = new Date(Date.now() + AUTH_EXPIRY);
  await database.insert(credentials).values([
    {
      account,
      id: credentialId,
      publicKey,
      factory: exaAccountFactoryAddress,
      transports: options?.webauthn?.transports,
      source: options?.source,
    },
  ]);

  await Promise.all([
    setSignedCookie(c, "credential_id", credentialId, authSecret, {
      expires,
      httpOnly: true,
      ...(domain === "localhost"
        ? { sameSite: "lax", secure: false }
        : { domain, sameSite: "none", secure: true, partitioned: true }),
    }),
    customer({
      flow: { name: "signup", type: "signup" },
      customer: {
        id: credentialId,
        tags: [{ name: "source", value: options?.source ?? "EXA", type: "string" }],
      },
    }).catch((error: unknown) => captureException(error, { level: "error" })),
  ]);

  const publish = () =>
    startSpan(
      { name: "account subscribe", op: "queue.publish", attributes: { "messaging.destination.name": "account" } },
      async (span) => {
        const job = await queue.add(
          "subscribe",
          { account, sentryBaggage: spanToBaggageHeader(span), sentryTrace: spanToTraceHeader(span) },
          { jobId: account },
        );
        span.setAttribute("messaging.message.id", job.id);
        span.setAttribute("messaging.message.body.size", Buffer.byteLength(JSON.stringify(job.data)));
      },
    );
  (getActiveSpan()
    ? publish()
    : startSpan({ name: "account subscribe producer", forceTransaction: true }, publish)
  ).catch((error: unknown) =>
    startSpan({ name: "account subscribe fallback", op: "queue.recover", attributes: { account } }, () =>
      addWebhookAddresses(webhookId, [account]),
    ).then(
      () =>
        captureException(error, {
          level: "warning",
          tags: { queue: "account", job: "subscribe", fallback: "succeeded" },
          extra: { account },
        }),
      (error_: unknown) =>
        captureException(new AggregateError([error, error_], "account subscription failed"), {
          level: "error",
          tags: { queue: "account", job: "subscribe", fallback: "failed" },
          extra: { account },
        }),
    ),
  );

  identify({ userId: account });
  return { credentialId, factory: parse(Address, exaAccountFactoryAddress), x, y, auth: expires.getTime() };
}

const attempts = 10;

const queue = new Queue<Subscription, void, "subscribe">("account", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts,
    backoff: { type: "exponential", delay: 1000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
  },
});

let worker: undefined | Worker<Subscription, void, "subscribe">;

export function startQueue() {
  worker ??= new Worker<Subscription, void, "subscribe">(
    "account",
    (job) => {
      const run = () =>
        startSpan({ name: `account ${job.name} consumer`, forceTransaction: true }, (parent) =>
          startSpan(
            {
              name: `account ${job.name}`,
              op: "queue.process",
              attributes: {
                "messaging.destination.name": "account",
                "messaging.message.id": job.id,
                "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job.data)),
                "messaging.message.receive.latency": Date.now() - job.timestamp,
                "messaging.message.retry.count": job.attemptsMade,
              },
            },
            async (span) => {
              try {
                await addWebhookAddresses(webhookId, [job.data.account]);
                span.setStatus({ code: SPAN_STATUS_OK });
                parent.setStatus({ code: SPAN_STATUS_OK });
              } catch (error: unknown) {
                span.setStatus({
                  code: SPAN_STATUS_ERROR,
                  message: error instanceof Error ? error.message : "queue process failed",
                });
                parent.setStatus({
                  code: SPAN_STATUS_ERROR,
                  message: error instanceof Error ? error.message : "queue process failed",
                });
                throw error;
              }
            },
          ),
        );
      return job.data.sentryTrace || job.data.sentryBaggage
        ? continueTrace({ sentryTrace: job.data.sentryTrace, baggage: job.data.sentryBaggage }, run)
        : run();
    },
    {
      connection: redisConnection,
      limiter: { max: 10, duration: 1000 },
    },
  )
    .on("failed", (job, error) => {
      if (job && job.attemptsMade < (job.opts.attempts ?? attempts)) return;
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          level: "error",
          tags: { queue: "account", job: job?.name },
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
        });
      });
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: "account" } });
    });
  return worker;
}

export async function closeQueue() {
  await worker?.close();
  worker = undefined;
  await queue.close();
}

export type Subscription = {
  account: Address;
  sentryBaggage?: string;
  sentryTrace?: string;
};
