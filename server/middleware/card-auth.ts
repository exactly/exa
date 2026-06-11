import { and, eq } from "drizzle-orm";
import { getSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { parse } from "valibot";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials, walletAddresses } from "../database";
import auth from "../utils/auth";
import authSecret from "../utils/authSecret";
import { verifyToken } from "../utils/walletExtension";

import type { BlankInput, Env, Input } from "hono/types";

export default function cardAuth<E extends Env = Env, P extends string = string, I extends Input = BlankInput>() {
  return createMiddleware<
    E,
    P,
    I & {
      out: {
        cookie: { credentialId: string };
        query: { scope?: "provisioning" | "siwe" | "webauthn" | ("provisioning" | "siwe" | "webauthn")[] };
      };
    }
  >(async (c, next) => {
    const credentialId = await getSignedCookie(c, authSecret, "credential_id");
    if (credentialId) {
      c.req.addValidatedData("cookie", { credentialId });
      await next();
      return;
    }

    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (session) {
      const addresses = await database.query.walletAddresses.findMany({
        where: and(eq(walletAddresses.userId, session.user.id), eq(walletAddresses.chainId, chain.id)),
        columns: { address: true, isPrimary: true },
      });
      const primary = addresses.filter(({ isPrimary }) => isPrimary);
      let address: Address | undefined;
      if (primary.length === 1 && primary[0]) {
        address = parse(Address, primary[0].address);
      } else if (addresses.length === 1 && addresses[0]) {
        address = parse(Address, addresses[0].address);
      }
      if (address) {
        const credential = await database.query.credentials.findFirst({
          where: eq(credentials.id, address),
          columns: { id: true },
        });
        if (credential) {
          c.req.addValidatedData("cookie", { credentialId: credential.id });
          await next();
          return;
        }
      }
    }

    const scopes = [c.req.valid("query").scope].flat();
    const [scheme = "", token] = c.req.header("authorization")?.split(" ", 2) ?? [];
    if (
      c.req.header("sessionid") ||
      scopes.length !== 1 ||
      scopes[0] !== "provisioning" ||
      scheme.toLowerCase() !== "bearer" ||
      !token
    ) {
      return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
    }
    const verified = await verifyToken(token);
    if (!verified) return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
    c.req.addValidatedData("cookie", { credentialId: verified.credentialId });
    await next();
  });
}
