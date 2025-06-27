import chain from "@exactly/common/generated/chain";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { nonceManager } from "viem";

import activity from "./activity";
import authentication from "./auth/authentication";
import registration from "./auth/registration";
import card from "./card";
import kyc from "./kyc";
import passkey from "./passkey";
import appOrigin from "../utils/appOrigin";
import keeper from "../utils/keeper";
import publicClient from "../utils/publicClient";

const api = new Hono()
  .use(cors({ origin: appOrigin, credentials: true }))
  .get("/debug", async (c) => {
    const nonce = await nonceManager.consume({
      address: keeper.account.address,
      chainId: chain.id,
      client: publicClient,
    });
    const message = `nonce ${nonce} skipped`;
    console.log(message); // eslint-disable-line no-console
    return c.json({ message });
  })
  .route("/auth/registration", registration)
  .route("/auth/authentication", authentication)
  .route("/activity", activity)
  .route("/card", card)
  .route("/kyc", kyc)
  .route("/passkey", passkey);

export default api;
export type ExaAPI = typeof api;
