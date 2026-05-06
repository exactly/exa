import { SPAN_STATUS_ERROR } from "@sentry/core";
import { addBreadcrumb, captureException, setUser, startSpan } from "@sentry/node";
import { Queue, Worker, type Job } from "bullmq";
import { setSignedCookie } from "hono/cookie";
import { parse } from "valibot";
import { hexToBytes, isAddress } from "viem";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { headers } from "./alchemy";
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
  if (!webhookId) throw new WebhookNotReadyError();

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
      counter: options?.webauthn?.counter,
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

  queue.add("create", { account, webhookId }).catch((error: unknown) =>
    captureException(error, {
      level: "error",
      extra: { job: "create", account, webhookId, credentialId },
    }),
  );

  identify({ userId: account });
  return { credentialId, factory: parse(Address, exaAccountFactoryAddress), x, y, auth: expires.getTime() };
}

const queueName = "account";

export const queue = new Queue(queueName, { connection: redisConnection });

export const worker = new Worker(
  queueName,
  (job: Job<{ account: Address; webhookId: string }>) =>
    startSpan(
      { name: "credential.processor", op: "queue.process", attributes: { job: job.name, ...job.data } },
      async (span) => {
        switch (job.name) {
          case "create": {
            const response = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
              method: "PATCH",
              headers,
              body: JSON.stringify({
                webhook_id: job.data.webhookId,
                addresses_to_add: [job.data.account],
                addresses_to_remove: [],
              }),
            });
            if (!response.ok) {
              const text = await response.text();
              span.setStatus({ code: SPAN_STATUS_ERROR, message: text });
              throw new Error(`${response.status} ${text}`);
            }
            break;
          }
          default: {
            const message = `Unknown job name: ${job.name}`;
            span.setStatus({ code: SPAN_STATUS_ERROR, message });
            throw new Error(message);
          }
        }
      },
    ),
  { connection: redisConnection, limiter: { max: 10, duration: 1000 } },
);

worker
  .on("failed", (job, error) => {
    captureException(error, { level: "error", extra: { job: job?.data } });
  })
  .on("completed", (job) => {
    addBreadcrumb({ category: "queue", message: `Job ${job.id} completed`, level: "info", data: { job: job.data } });
  })
  .on("active", (job) => {
    addBreadcrumb({ category: "queue", message: `Job ${job.id} active`, level: "info", data: { job: job.data } });
  })
  .on("error", (error) => {
    captureException(error, { level: "error", tags: { queue: queueName } });
  });

export async function closeQueue() {
  await Promise.all([worker.close(), queue.close()]);
}

export class WebhookNotReadyError extends Error {
  constructor() {
    super("alchemy webhook not initialized yet, retry credential creation");
    this.name = "WebhookNotReadyError";
  }
}
