import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import {
  captureException,
  continueTrace,
  getIsolationScope,
  startSpan,
  withActiveSpan,
  withIsolationScope,
  withScope,
} from "@sentry/node";
import { DelayedError, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { argv } from "node:process";

import { own } from "../supervise";

import type { Breadcrumb, Scope, Span } from "@sentry/core";
import type * as BullMQ from "bullmq";

export default function worker<Job extends { sentryBaggage?: string; sentryTrace?: string }, Ready = unknown>({
  attempts,
  bullmq,
  failed,
  name,
  process,
  ready,
}: {
  attempts: number;
  bullmq: Redis;
  failed: (job: BullMQ.Job<Job> | undefined, error: Error) => void;
  name: string;
  process: (job: BullMQ.Job<Job>, span: Span, token?: string) => Promise<void>;
  ready?: Promise<Ready>;
}) {
  const check = argv.includes("--check");
  const scopes = new WeakMap<Error, { isolation: Scope; span: Span }>();
  const breadcrumbs: Breadcrumb[] = [];
  let started = false;
  let pending: Error | undefined;
  const queue = new Worker<Job, void>(
    name,
    (job, token) => {
      const callback = () =>
        startSpan({ name: `${job.name} worker`, forceTransaction: true }, (parent) =>
          startSpan(
            {
              attributes: {
                "messaging.system": "redis",
                "messaging.destination.name": name,
                "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job.data)),
                "messaging.message.id": job.id,
                "messaging.message.receive.latency": Date.now() - job.timestamp,
                "messaging.message.retry.count": job.attemptsMade,
              },
              name: job.name,
              op: "queue.process",
            },
            async (span) => {
              try {
                await process(job, span, token);
                span.setStatus({ code: SPAN_STATUS_OK });
                parent.setStatus({ code: SPAN_STATUS_OK });
              } catch (error: unknown) {
                if (error instanceof DelayedError) {
                  span.setStatus({ code: SPAN_STATUS_OK });
                  parent.setStatus({ code: SPAN_STATUS_OK });
                  throw error;
                }
                const message =
                  error instanceof Error ? error.message : typeof error === "string" ? error : "queue process failed";
                const status = { code: SPAN_STATUS_ERROR, message } as const;
                span.setStatus(status);
                parent.setStatus(status);
                const failure = error instanceof Error ? error : new Error(message, { cause: error });
                scopes.set(failure, { isolation: getIsolationScope(), span });
                throw failure;
              }
            },
          ),
        );
      return withIsolationScope(() =>
        job.data.sentryTrace || job.data.sentryBaggage
          ? continueTrace({ sentryTrace: job.data.sentryTrace, baggage: job.data.sentryBaggage }, callback)
          : callback(),
      );
    },
    { connection: bullmq, limiter: { max: 10, duration: 1000 }, autorun: !check },
  )
    .on("failed", (job, error) => {
      if (job && job.attemptsMade < (job.opts.attempts ?? attempts) && !(error instanceof UnrecoverableError)) return;
      const scope = scopes.get(error);
      if (scope) withIsolationScope(scope.isolation, () => withActiveSpan(scope.span, () => failed(job, error)));
      else failed(job, error);
    })
    .on("error", (error) => {
      if (started) {
        captureException(error, { level: "error", tags: { queue: name } });
        return;
      }
      breadcrumbs.push({
        category: "queue",
        data: { queue: name },
        level: "error",
        message: error.message,
        timestamp: Date.now() / 1000,
      });
      if (breadcrumbs.length > 20) breadcrumbs.shift();
      pending = error;
    });
  const deadline = setTimeout(() => {
    pending ??= new Error(`${name} worker not ready`);
    report();
  }, 120_000);
  const connected = queue.waitUntilReady().then((client) => {
    clearTimeout(deadline);
    started = true;
    return client;
  });
  return own({ check, queue, ready: Promise.all([connected, ready]) }, () => {
    clearTimeout(deadline);
    report();
    return queue.close().finally(report);
  });

  function report() {
    const error = pending;
    if (started || !error) return;
    withScope((scope) => {
      for (const breadcrumb of breadcrumbs) scope.addBreadcrumb(breadcrumb);
      captureException(error, { level: "error", tags: { queue: name } });
    });
    breadcrumbs.length = 0;
    pending = undefined;
  }
}

export function connect(redisUrl: string) {
  return new Redis(redisUrl, { maxRetriesPerRequest: null });
}
