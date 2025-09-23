import domain from "@exactly/common/domain";
import { captureException } from "@sentry/core";
import { betterAuth } from "better-auth";
import { siwe, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc, ownerAc, memberAc } from "better-auth/plugins/organization/access";
import { verifyMessage } from "viem";
import { generateSiweNonce } from "viem/siwe";

import authSecret from "./authSecret";
import { authAdapter } from "../database/index";
const ac = createAccessControl({
  ...defaultStatements,
  webhook: ["create", "delete", "read"],
  kyc: ["create", "delete", "read"],
});

export default betterAuth({
  database: authAdapter,
  baseURL: `https://${domain}`,
  secret: authSecret,
  plugins: [
    siwe({
      domain,
      emailDomainName: domain,
      anonymous: true,
      getNonce: async () => {
        return await Promise.resolve(generateSiweNonce());
      },
      verifyMessage: async ({ message, signature, address }) => {
        try {
          const isValid = await verifyMessage({
            address: address as `0x${string}`,
            message,
            signature: signature as `0x${string}`,
          });
          return isValid;
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
          kyc: ["create"],
          ...adminAc.statements,
        }),
        owner: ac.newRole({
          webhook: ["create", "delete", "read"],
          kyc: ["create"],
          ...ownerAc.statements,
        }),
        member: ac.newRole({
          ...memberAc.statements,
        }),
      },
      allowUserToCreateOrganization: (user) => true,
    }),
  ],
});
