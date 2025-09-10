import domain from "@exactly/common/domain";
import { captureException } from "@sentry/core";
import { betterAuth } from "better-auth";
import { siwe, organization } from "better-auth/plugins";
import { verifyMessage } from "viem";
import { generateSiweNonce } from "viem/siwe";

import authSecret from "./authSecret";
import { authAdapter } from "../database/index";

export default betterAuth({
  database: authAdapter,
  baseURL: `https://${domain}`,
  secret: authSecret,
  plugins: [
    siwe({
      domain,
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
      allowUserToCreateOrganization: (user) => true,
    }),
  ],
});
