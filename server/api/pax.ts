import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { object, string } from "valibot";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import deriveAssociateId from "../utils/deriveAssociateId";

const AssociateResponse = object({
  associateId: string(),
});

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
            schema: resolver(AssociateResponse),
          },
        },
      },
      404: {
        description: "Not found",
      },
    },
  }),
  async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
    });

    if (!credential) return c.json({ code: "no credential" }, 404);

    return c.json({ associateId: deriveAssociateId(credential.account) }, 200);
  },
);

export default app;

export type AppType = typeof app;
