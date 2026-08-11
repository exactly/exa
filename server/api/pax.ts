import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { object, safeParse, string } from "valibot";

import { Address } from "@exactly/common/validation";

import { credentials } from "../database/schema";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type createPax from "../utils/pax";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export default function route({
  auth,
  database,
  pax,
}: {
  auth: Auth;
  database: NodePgDatabase<typeof schema>;
  pax: ReturnType<typeof createPax>;
}) {
  return new Hono().get(
    "/",
    auth,
    describeRoute({
      summary: "Get associate data",
      description: "Get the associate data for the authenticated user",
      tags: ["Pax"],
      responses: {
        200: {
          description: "Associate data",
          content: { "application/json": { schema: resolver(object({ associateId: string() })) } },
        },
        500: { description: "Internal server error" },
      },
    }),
    async (c) => {
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, c.req.valid("cookie").credentialId),
        columns: { account: true },
      });

      if (!credential) return c.json({ code: "no credential" }, 500);

      const account = safeParse(Address, credential.account);
      if (!account.success) return c.json({ code: "invalid account" }, 500);
      return c.json({ associateId: pax.deriveAssociateId(account.output) }, 200);
    },
  );
}
