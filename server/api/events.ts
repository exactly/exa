import { setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { parse } from "valibot";

import { Address } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import { subscribe } from "../utils/events";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export type { Kind } from "../utils/events";

export default function events({ auth, database }: { auth: Auth; database: NodePgDatabase<typeof schema> }) {
  return new Hono().get(
    "/",
    auth,
    describeRoute({
      summary: "Stream account events",
      description: `
Open a server-sent event stream for the authenticated user's account.

The stream starts with a \`ready\` event and then sends one event each time something changes for the account. The event name is the kind of change: \`activity\`, \`card\`, \`kyc\`, \`proposals\`, or \`ramp\`. Events carry no data: refetch the matching resources when one arrives, and refetch everything after every \`ready\`, since changes made while disconnected are not replayed. A comment line is sent every 30 seconds to keep idle connections open. The stream ends when the server shuts down: reconnect with backoff.
      `,
      tags: ["Events"],
      security: [{ credentialAuth: [] }],
      responses: {
        200: { description: "Account event stream", content: { "text/event-stream": { schema: { type: "string" } } } },
        401: { description: "Unauthorized" },
        500: { description: "Internal server error" },
      },
    }),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true },
      });
      if (!credential) return c.json({ code: "no credential" }, 500);
      const account = parse(Address, credential.account);
      setUser({ id: account });
      c.header("X-Accel-Buffering", "no");
      return streamSSE(
        c,
        (stream) =>
          new Promise<void>((resolve) => {
            const unsubscribe = subscribe(account, (kind) => stream.writeSSE({ event: kind, data: "" }), end);
            if (!unsubscribe) {
              resolve();
              return;
            }
            const heartbeat = setInterval(() => {
              stream.write(": \n\n").catch(() => undefined);
            }, 30_000);
            stream.onAbort(end);
            stream.writeSSE({ event: "ready", data: "" }).catch(() => undefined);

            function end() {
              clearInterval(heartbeat);
              unsubscribe?.();
              resolve();
            }
          }),
      );
    },
  );
}
