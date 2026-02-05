import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";

import activity from "./activity";
import authentication from "./auth/authentication";
import registration from "./auth/registration";
import card from "./card";
import kyc from "./kyc";
import passkey from "./passkey";
import pax from "./pax";
import ramp from "./ramp";
import appOrigin from "../utils/appOrigin";

const api = new Hono()
  .use(cors({ origin: [appOrigin, "http://localhost:8081"], credentials: true }))
  .use((c, next) => {
    if (c.req.method.toUpperCase() === "OPTIONS") return next();
    if (!c.req.header("origin") && !c.req.header("sec-fetch-site")) return next();
    return csrf({ origin: [appOrigin, "http://localhost:8081"] })(c, next);
  })
  .route("/auth/registration", registration)
  .route("/auth/authentication", authentication)
  .route("/activity", activity)
  .route("/card", card)
  .route("/kyc", kyc)
  .route("/passkey", passkey) // eslint-disable-line @typescript-eslint/no-deprecated -- // TODO remove
  .route("/pax", pax)
  .route("/ramp", ramp);

export default api;
export type ExaAPI = typeof api;
