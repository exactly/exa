import { captureException } from "@sentry/node";

import type { Notification, Pool } from "pg";

export default function listen(
  pool: Pool,
  sync: (payload?: string) => Promise<unknown>,
  tags?: Record<string, string>,
  channel = "indexer_live_query",
) {
  let closed = false;
  let drop: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let syncing: Promise<unknown> = Promise.resolve();
  let reconnecting: Promise<unknown> = Promise.resolve();
  const capture = (error: unknown) => {
    captureException(error, { level: "error", tags });
  };
  const schedule = (notification?: Notification) => {
    if (closed) return;
    syncing = syncing.then(() => sync(notification?.payload)).catch(capture);
  };

  async function connect() {
    const client = await pool.connect();
    let released = false;
    const release = (error: boolean | Error) => {
      if (released) return;
      released = true;
      if (drop === close) drop = undefined;
      client.off("notification", schedule);
      client.release(error);
    };
    const close = () => {
      release(true);
    };
    client.on("notification", schedule);
    client.on("error", (error) => {
      const live = drop === close;
      capture(error);
      release(error);
      if (live && !closed) reconnect();
    });
    try {
      await client.query(`LISTEN "${channel}"`);
    } catch (error) {
      release(true);
      throw error;
    }
    if (closed) return close();
    drop = close;
  }

  function reconnect() {
    reconnecting = connect().then(
      () => schedule(),
      (error: unknown) => {
        capture(error);
        if (!closed) timer = setTimeout(reconnect, 1000);
      },
    );
  }

  const ready = connect().then(() => {
    if (closed) return;
    syncing = syncing.then(() => sync());
    return syncing;
  });
  return {
    ready,
    close() {
      closed = true;
      clearTimeout(timer);
      drop?.();
      return ready
        .then(
          () => reconnecting,
          () => reconnecting,
        )
        .then(() => syncing)
        .then(
          () => undefined,
          () => undefined,
        );
    },
  };
}
