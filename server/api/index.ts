import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";

import activity from "./activity";
import authentication from "./auth/authentication";
import registration from "./auth/registration";
import card from "./card";
import chatRoute from "./chat";
import kyc from "./kyc";
import passkey from "./passkey";
import paxRoute from "./pax";
import ramp from "./ramp";
import webhook from "./webhook";
import createAuth from "../middleware/auth";
import createOrg from "../middleware/org";
import appOrigin from "../utils/appOrigin";
import createBetterAuth from "../utils/auth";
import createCredential from "../utils/createCredential";

import type * as schema from "../database/schema";
import type createIntercom from "../utils/intercom";
import type createPanda from "../utils/panda";
import type createPax from "../utils/pax";
import type createPersona from "../utils/persona";
import type createBridge from "../utils/ramps/bridge";
import type createManteca from "../utils/ramps/manteca";
import type createSardine from "../utils/sardine";
import type createSegment from "../utils/segment";
import type createWalletExtension from "../utils/walletExtension";
import type createWhatsapp from "../utils/whatsapp";
import type createCredit from "../workers/credit/queue";
import type createSubscribe from "../workers/subscribe/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

export default function api({
  authSecret,
  bridge,
  chat,
  credit,
  database,
  intercom,
  manteca,
  panda,
  pax,
  persona,
  redis,
  sardine,
  segment,
  subscribe,
  walletExtension,
}: {
  authSecret: string;
  bridge: ReturnType<typeof createBridge>;
  chat: ReturnType<typeof createWhatsapp>;
  credit: ReturnType<typeof createCredit>;
  database: NodePgDatabase<typeof schema>;
  intercom: ReturnType<typeof createIntercom>;
  manteca: ReturnType<typeof createManteca>;
  panda: ReturnType<typeof createPanda>;
  pax: ReturnType<typeof createPax>;
  persona: ReturnType<typeof createPersona>;
  redis: Redis;
  sardine: ReturnType<typeof createSardine>;
  segment: ReturnType<typeof createSegment>;
  subscribe: ReturnType<typeof createSubscribe>;
  walletExtension: ReturnType<typeof createWalletExtension>;
}) {
  const betterAuth = createBetterAuth(database, authSecret);
  const auth = createAuth(authSecret);
  const org = createOrg(betterAuth);
  const credential = createCredential({ authSecret, database, sardine, segment, subscribe });
  const app = new Hono()
    .use(cors({ origin: [appOrigin, "http://localhost:8081"], credentials: true, exposeHeaders: ["X-Session-Id"] }))
    .use((c, next) => {
      if (c.req.method.toUpperCase() === "OPTIONS") return next();
      if (!c.req.header("origin") && !c.req.header("sec-fetch-site")) return next();
      return csrf({ origin: [appOrigin, "http://localhost:8081"] })(c, next);
    })
    .route("/auth/registration", registration({ createCredential: credential, intercom, redis, walletExtension }))
    .route(
      "/auth/authentication",
      authentication({ authSecret, createCredential: credential, database, intercom, redis, walletExtension }),
    )
    .route("/activity", activity({ auth, database }))
    .route("/card", card({ auth, credit, database, panda, pax, persona, sardine, segment, walletExtension }))
    .route("/chat", chatRoute({ auth, chat, database, redis }))
    .route("/kyc", kyc({ auth, database, panda, persona }))
    .route("/passkey", passkey({ auth, database })) // eslint-disable-line @typescript-eslint/no-deprecated -- // TODO remove
    .route("/pax", paxRoute({ auth, database, pax }))
    .route("/ramp", ramp({ auth, bridge, database, manteca, persona }))
    .route("/webhook", webhook({ betterAuth, database, org }))
    .on(["POST", "GET"], "/auth/*", (c) => betterAuth.handler(c.req.raw));
  return { app, ready: Promise.resolve() };
}

export type ExaAPI = ReturnType<typeof api>["app"];
