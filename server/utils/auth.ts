import { captureException } from "@sentry/core";
import { betterAuth } from "better-auth";
import { organization, siwe } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { safeParse } from "valibot";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import appOrigin from "./appOrigin";
import authSecret from "./authSecret";
import publicClient from "./publicClient";
import { authAdapter } from "../database/index";
const ac = createAccessControl({
  ...defaultStatements,
  webhook: ["create", "delete", "read"],
});

export default betterAuth({
  database: authAdapter,
  baseURL: appOrigin,
  trustedOrigins: [appOrigin],
  secret: authSecret,
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
        if (siweMessage.nonce !== cacao.p.nonce || siweMessage.domain !== domain || siweMessage.chainId !== chain.id) {
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
          webhook: ["create", "delete", "read"],
          ...adminAc.statements,
        }),
        owner: ac.newRole({
          webhook: ["create", "delete", "read"],
          ...ownerAc.statements,
        }),
        member: ac.newRole({
          ...memberAc.statements,
        }),
      },
      allowUserToCreateOrganization: () => true,
    }),
  ],
});
