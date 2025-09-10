import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";

import activity from "./activity";
import authentication from "./auth/authentication";
import registration from "./auth/registration";
import card from "./card";
import kyc from "./kyc";
import passkey from "./passkey";
import webhook from "./webhook";
import appOrigin from "../utils/appOrigin";

const api = new Hono()
  .use(cors({ origin: appOrigin, credentials: true }))
  .use(csrf({ origin: appOrigin }))
  .route("/auth/registration", registration)
  .route("/auth/authentication", authentication)
  .route("/activity", activity)
  .route("/card", card)
  .route("/kyc", kyc)
  .route("/passkey", passkey)
  .route("/webhook", webhook);

export default api;
export type ExaAPI = typeof api;
