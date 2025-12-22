import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { object, string } from "valibot";

import { eq } from "drizzle-orm";
import database, { credentials } from "../database";
import auth from "../middleware/auth";
import deriveAssociateId from "../utils/deriveAssociateId";

const AssociateResponse = object({
  associateId: string(),
});

export default new Hono().get(
  "/associate",
  auth(),
  describeRoute({
    summary: "Get associate ID",
    description: "Get the deterministic associate ID for the authenticated user",
    tags: ["Pax"],
    responses: {
      200: {
        description: "Associate ID",
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
