import { serve } from "@hono/node-server";
import { captureException, close as closeSentry } from "@sentry/node";
import process, { exit } from "node:process";

import ServiceError from "./utils/ServiceError";

import type { Hono } from "hono";
import type { UnofficialStatusCode } from "hono/utils/http-status";

export default function supervise<App extends Hono | undefined = undefined>(
  name: string,
  created: Promise<Handle<App>>,
) {
  let closing: Promise<unknown> | undefined;
  let server: ReturnType<typeof serve> | undefined;

  created
    .then(async (handle) => {
      const { app } = handle;
      app?.onError((error, c) => {
        captureException(error, {
          level: "error",
          tags: { unhandled: true },
          fingerprint: error instanceof ServiceError ? ["{{ default }}", error.name, error.message] : undefined,
        });
        return c.json({ code: "unexpected error", legacy: "unexpected error" }, 555 as UnofficialStatusCode);
      });
      await handle.ready;
      if (handle.check) return shutdown();
      if (closing || !app) return;
      server = serve(app);
      server.once("error", fail);
    })
    .catch(fail);

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return close;

  function close() {
    closing ??= created
      .catch(() => undefined)
      .then((handle) => {
        if (!handle) return;
        const active = server;
        if (!active?.listening) return handle.close();
        return new Promise<void>((resolve, reject) => {
          active.close((error) => (error ? reject(error) : resolve()));
        }).finally(() => handle.close());
      })
      .catch((error: unknown) => {
        console.error(error); // eslint-disable-line no-console
        captureException(error, { level: "fatal", tags: { close: true, entrypoint: name } });
        throw error;
      })
      .finally(() => closeSentry());
    return closing;
  }

  function fail(error: unknown) {
    if (closing) return;
    console.error(error); // eslint-disable-line no-console
    captureException(error, { level: "fatal", tags: { startup: true, entrypoint: name } });
    process.exitCode = 1;
    shutdown();
  }

  function shutdown() {
    if (closing) return;
    close().then(
      () => exit(process.exitCode ?? 0),
      () => exit(1),
    );
  }
}

export function own<Result extends object>(
  result: Result & { close?(): Promise<unknown> },
  ...closers: readonly (() => Promise<unknown>)[]
) {
  let closing: Promise<unknown> | undefined;
  return {
    ...result,
    close: () =>
      (closing ??= Promise.resolve()
        .then(() => result.close?.())
        .finally(() =>
          Promise.allSettled(closers.map((close) => Promise.resolve().then(close))).then((results) => {
            const failure = results.find((outcome) => outcome.status === "rejected");
            if (failure?.status === "rejected") throw failure.reason;
          }),
        )),
  };
}

type Handle<App extends Hono | undefined = undefined> = {
  app?: App;
  check?: boolean;
  close(): Promise<unknown>;
  ready: Promise<unknown>;
};
