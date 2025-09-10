import { captureException } from "@sentry/core";
import { betterAuth } from "better-auth";
import { organization, siwe } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, memberAc, ownerAc } from "better-auth/plugins/organization/access";
import { safeParse } from "valibot";
import { verifyMessage } from "viem";
import { generateSiweNonce } from "viem/siwe";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import appOrigin from "./appOrigin";
import authSecret from "./authSecret";
import { authAdapter } from "../database/index";
const ac = createAccessControl({
  ...defaultStatements,
});

export default betterAuth({
  database: authAdapter,
  baseURL: appOrigin,
  trustedOrigins: [appOrigin],
  secret: authSecret,
  user: { changeEmail: { enabled: true } },
  plugins: [
    siwe({
      domain,
      emailDomainName: domain === "localhost" ? "localhost.com" : domain,
      anonymous: true,
      getNonce: () => Promise.resolve(generateSiweNonce()),
      verifyMessage: async ({ message, signature, address, chainId }) => {
        if (chainId !== chain.id) return false;

        const parsedAddress = safeParse(Address, address);
        const parsedSignature = safeParse(Hex, signature);
        if (!parsedAddress.success || !parsedSignature.success) return false;
        try {
          return await verifyMessage({
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
          ...adminAc.statements,
        }),
        owner: ac.newRole({
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
