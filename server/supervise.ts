import { serve } from "@hono/node-server";
import { captureException, close as closeSentry } from "@sentry/node";

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
        let fingerprint: string[] | undefined;
        const message = error.message
          .split("Error:")
          .reduce((result, part) => (result ? `${result}Error:${part}` : part.trimStart()), "");
        const status = message.slice(0, 3);
        const hasStatus = /^\d{3}$/.test(status);
        const hasBodyFormat = message.length === 3 || message[3] === " ";
        const body = hasBodyFormat && message.length > 3 ? message.slice(4).trim() : undefined;
        if (hasStatus && hasBodyFormat) fingerprint = ["{{ default }}", status];
        if (hasStatus && hasBodyFormat && body) {
          try {
            const json = JSON.parse(body) as { code?: unknown; error?: unknown; message?: unknown };
            fingerprint = [
              "{{ default }}",
              status,
              ...("code" in json
                ? [String(json.code)]
                : typeof json.message === "string"
                  ? [json.message]
                  : typeof json.error === "string"
                    ? [json.error]
                    : [body]),
            ];
          } catch {
            fingerprint = ["{{ default }}", status, body];
          }
        }
        captureException(error, { level: "error", tags: { unhandled: true }, fingerprint });
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
        captureException(error, { level: "fatal", tags: { close: true, entrypoint: name } });
        throw error;
      })
      .finally(() => closeSentry());
    return closing;
  }

  function fail(error: unknown) {
    if (closing) return;
    captureException(error, { level: "fatal", tags: { startup: true, entrypoint: name } });
    process.exitCode = 1;
    shutdown();
  }

  function shutdown() {
    if (closing) return;
    close().then(
      () => process.exit(process.exitCode ?? 0), // eslint-disable-line n/no-process-exit, unicorn/no-process-exit
      () => process.exit(1), // eslint-disable-line n/no-process-exit, unicorn/no-process-exit
    );
  }
}

type Handle<App extends Hono | undefined = undefined> = {
  app?: App;
  check?: boolean;
  close(): Promise<unknown>;
  ready: Promise<unknown>;
};
