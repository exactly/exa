import { captureException } from "@sentry/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { organization, siwe } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import assert from "node:assert";
import { randomBytes } from "node:crypto";
import { object, safeParse, string } from "valibot";
import { parseSiweMessage } from "viem/siwe";

import AUTH_EXPIRY from "@exactly/common/AUTH_EXPIRY";
import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import appOrigin from "./appOrigin";
import publicClient from "./publicClient";
import { users } from "../database/schema";
import * as schema from "../database/schema";

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Context } from "hono";
import type { Redis } from "ioredis";

const ac = createAccessControl({
  ...defaultStatements,
  webhook: ["create", "delete", "read", "update"],
  kyc: ["create", "delete", "read"],
});

export default function auth(database: NodePgDatabase<typeof schema>, secret: string, redis?: Redis) {
  const emailDomainName = domain === "localhost" ? "localhost.com" : domain;
  return betterAuth({
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.authenticators,
        verification: schema.verifications,
        walletAddress: schema.walletAddresses,
        organization: schema.organizations,
        member: schema.members,
        invitation: schema.invitations,
      },
    }),
    ...(redis && {
      secondaryStorage: {
        get: (key) => redis.get(`auth:${key}`),
        getAndDelete: (key) => redis.getdel(`auth:${key}`),
        set: async (key, value, ttl) => {
          await (ttl ? redis.set(`auth:${key}`, value, "EX", ttl) : redis.set(`auth:${key}`, value));
        },
        delete: async (key) => {
          await redis.del(`auth:${key}`);
        },
        increment: async (key, ttl) => {
          const [[, count]] = (await redis.multi().incr(`auth:${key}`).expire(`auth:${key}`, ttl, "NX").exec()) as [
            [null, number],
            [null, number],
          ];
          return count;
        },
      },
    }),
    baseURL: appOrigin,
    trustedOrigins: [appOrigin],
    secret,
    session: {
      expiresIn: AUTH_EXPIRY / 1000,
      disableSessionRefresh: true,
      storeSessionInDatabase: true,
    },
    advanced: {
      defaultCookieAttributes:
        domain === "localhost"
          ? { sameSite: "lax", secure: false }
          : { sameSite: "none", secure: true, partitioned: true },
    },
    plugins: [
      siwe({
        domain: new URL(appOrigin).host,
        emailDomainName,
        anonymous: true,
        getNonce: () => Promise.resolve(randomBytes(32).toString("hex")),
        verifyMessage: async ({ message, signature, address, chainId, cacao }) => {
          if (chainId !== chain.id) return false;
          const parsedAddress = safeParse(Address, address);
          const parsedSignature = safeParse(Hex, signature);
          if (!parsedAddress.success || !parsedSignature.success) return false;
          if (!cacao) return false;
          const siweMessage = parseSiweMessage(message);
          if (
            siweMessage.nonce !== cacao.p.nonce ||
            siweMessage.domain !== new URL(appOrigin).host ||
            siweMessage.chainId !== chain.id
          ) {
            return false;
          }
          try {
            return await publicClient.verifyMessage({
              address: parsedAddress.output,
              message,
              signature: parsedSignature.output,
            });
          } catch (error) {
            captureException(error, { level: "error" });
            return false;
          }
        },
      }),
      organization({
        ac,
        roles: {
          admin: ac.newRole({
            webhook: ["create", "delete", "read", "update"],
            kyc: ["create"],
            ...adminAc.statements,
          }),
          owner: ac.newRole({
            webhook: ["create", "delete", "read", "update"],
            kyc: ["create"],
            ...ownerAc.statements,
          }),
          member: ac.newRole({
            ...memberAc.statements,
          }),
        },
        additionalFields: {
          role: { type: "string", required: false, input: false },
        },
        allowUserToCreateOrganization: () => true,
      }),
      {
        id: "exa",
        hooks: {
          before: [
            {
              matcher: ({ path }) => path === "/siwe/nonce" || path === "/siwe/get-nonce" || path === "/siwe/verify",
              handler: createAuthMiddleware((context) => {
                if (!context.body || typeof context.body !== "object") return Promise.resolve();
                const body = context.body as Record<string, unknown>;
                const { walletAddress, chainId } = body;
                if (walletAddress === undefined && chainId === undefined) return Promise.resolve();
                if (context.path === "/siwe/verify") {
                  const message = typeof body.message === "string" ? parseSiweMessage(body.message) : undefined;
                  if (
                    !message?.address ||
                    (walletAddress !== undefined &&
                      (typeof walletAddress !== "string" ||
                        walletAddress.toLowerCase() !== message.address.toLowerCase())) ||
                    (chainId !== undefined && chainId !== message.chainId)
                  ) {
                    throw APIError.fromStatus("UNAUTHORIZED", {
                      message:
                        "Unauthorized: SIWE message does not match the expected nonce, domain, address, or chain ID",
                      status: 401,
                      code: "UNAUTHORIZED_SIWE_MESSAGE_MISMATCH",
                    });
                  }
                }
                delete body.walletAddress;
                delete body.chainId;
                return Promise.resolve();
              }),
            },
          ],
        },
        endpoints: {
          signInCredential: createAuthEndpoint.serverOnly(
            { method: "POST", body: object({ credentialId: string() }) },
            async (context) => {
              const { credentialId } = context.body;
              await database
                .insert(users)
                .values({
                  id: credentialId,
                  name: credentialId,
                  email: `${credentialId}@credential.${emailDomainName}`,
                })
                .onConflictDoNothing();
              const user = await context.context.internalAdapter.findUserById(credentialId);
              assert.ok(user);
              const session = await context.context.internalAdapter.createSession(user.id);
              await setSessionCookie(context, { session, user });
              return context.json({ session, user });
            },
          ),
        },
      },
    ],
  });
}

export function signIn(instance: ReturnType<typeof auth>) {
  return async (c: Context, credentialId: string) => {
    const { headers, response } = await instance.api.signInCredential({
      body: { credentialId },
      returnHeaders: true,
    });
    for (const cookie of headers.getSetCookie()) c.header("set-cookie", cookie, { append: true });
    return response.session.expiresAt;
  };
}
