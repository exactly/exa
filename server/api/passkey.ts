import { setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver } from "hono-openapi/valibot";
import { parse, type InferOutput } from "valibot";

import { Address, Credential } from "@exactly/common/validation";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import decodePublicKey from "../utils/decodePublicKey";

export default new Hono().get(
  "/",
  describeRoute({
    summary: "Get passkey metadata",
    responses: {
      200: {
        description: "Passkey metadata",
        content: { "application/json": { schema: resolver(Credential, { errorMode: "ignore" }) } },
      },
    },
    validateResponse: true,
  }),
  auth(),
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
