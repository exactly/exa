import { captureException } from "@sentry/core";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization, siwe } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { safeParse } from "valibot";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import appOrigin from "./appOrigin";
import publicClient from "./publicClient";
import * as schema from "../database/schema";

import type db from "../database";
const ac = createAccessControl({
  ...defaultStatements,
  webhook: ["create", "delete", "read", "update"],
  kyc: ["create", "delete", "read"],
});

export default function auth(database: typeof db, secret: string) {
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
    baseURL: appOrigin,
    trustedOrigins: [appOrigin],
    secret,
    plugins: [
      siwe({
        domain,
        emailDomainName: domain === "localhost" ? "localhost.com" : domain,
        anonymous: true,
        getNonce: () => Promise.resolve(generateSiweNonce()),
        verifyMessage: async ({ message, signature, address, chainId, cacao }) => {
          if (chainId !== chain.id) return false;
          const parsedAddress = safeParse(Address, address);
          const parsedSignature = safeParse(Hex, signature);
          if (!parsedAddress.success || !parsedSignature.success) return false;
          if (!cacao) return false;
          const siweMessage = parseSiweMessage(message);
          if (
            siweMessage.nonce !== cacao.p.nonce ||
            siweMessage.domain !== domain ||
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
    ],
  });
}
