import { setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { parse, type InferOutput } from "valibot";

import { Address, Credential } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import decodePublicKey from "../utils/decodePublicKey";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/** @deprecated covered by authentication */
export default function route({ auth, database }: { auth: Auth; database: NodePgDatabase<typeof schema> }) {
  return new Hono().get(
    "/",
    describeRoute({
      deprecated: true,
      summary: "Get passkey metadata",
      responses: {
        200: {
          description: "Passkey metadata",
          content: { "application/json": { schema: resolver(Credential, { errorMode: "ignore" }) } },
        },
      },
      validateResponse: true,
    }),
    auth,
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { publicKey: true, account: true, factory: true },
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
      setUser({ id: parse(Address, credential.account) });
      return c.json(
        {
          credentialId,
          factory: parse(Address, credential.factory),
          ...decodePublicKey(credential.publicKey),
        } satisfies InferOutput<typeof Credential>,
        200,
      );
    },
  );
}
