import { Address } from "@exactly/common/validation";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { object, parse, string } from "valibot";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import { deriveAssociateId } from "../utils/pax";

const app = new Hono().get(
  "/",
  auth(),
  describeRoute({
    summary: "Get associate data",
    description: "Get the associate data for the authenticated user",
    tags: ["Pax"],
    responses: {
      200: {
        description: "Associate data",
        content: {
          "application/json": {
            schema: resolver(object({ associateId: string() })),
          },
        },
      },
      500: {
        description: "Internal server error",
      },
    },
  }),
  async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
    });

    if (!credential) throw new Error("no credential found for authenticated user");

    const account = parse(Address, credential.account);
    return c.json({ associateId: deriveAssociateId(account) }, 200);
  },
);

export default app;

export type AppType = typeof app;
