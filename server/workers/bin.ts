import { captureException, close as closeSentry } from "@sentry/node";

export default function bin(name: string, created: Promise<Worker>) {
  let closing: Promise<unknown> | undefined;
  let stopping = false;

  created
    .then((worker) => worker.ready)
    .catch((error: unknown) => {
      if (stopping) return;
      captureException(error, { level: "fatal", tags: { startup: true, worker: name } });
      process.exitCode = 1;
      return close().catch(() => undefined);
    });

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  function close() {
    stopping = true;
    closing ??= created
      .catch(() => undefined)
      .then((worker) => worker?.close())
      .catch((error: unknown) => {
        captureException(error, { level: "fatal", tags: { close: true, worker: name } });
        throw error;
      })
      .finally(() => closeSentry());
    return closing;
  }

  function stop() {
    if (stopping) return;
    close().then(
      () => process.exit(process.exitCode ?? 0), // eslint-disable-line n/no-process-exit, unicorn/no-process-exit
      () => process.exit(1), // eslint-disable-line n/no-process-exit, unicorn/no-process-exit
    );
  }
}

type Worker = {
  close(): Promise<unknown>;
  ready: Promise<unknown>;
};
