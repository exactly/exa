import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { Redis } from "ioredis";

import activity from "./activity";
import authentication from "./auth/authentication";
import registration from "./auth/registration";
import card from "./card";
import kyc from "./kyc";
import passkey from "./passkey";
import paxRoute from "./pax";
import ramp from "./ramp";
import webhook from "./webhook";
import * as schema from "../database/schema";
import createAuth from "../middleware/auth";
import createOrg from "../middleware/org";
import createAlchemy from "../utils/alchemy";
import appOrigin from "../utils/appOrigin";
import createBetterAuth from "../utils/auth";
import createCredential from "../utils/createCredential";
import createIntercom from "../utils/intercom";
import createPanda from "../utils/panda";
import createPax from "../utils/pax";
import createPersona from "../utils/persona";
import createBridge from "../utils/ramps/bridge";
import createManteca from "../utils/ramps/manteca";
import createSardine from "../utils/sardine";
import createSegment from "../utils/segment";
import createWalletExtension from "../utils/walletExtension";
import createSubscribe from "../workers/subscribe/queue";

export default function api({
  alchemyKey,
  authSecret,
  bridgeKey,
  bridgeUrl,
  intercomKey,
  mantecaKey,
  mantecaUrl,
  pandaKey,
  pandaUrl,
  paxAssociateKey,
  paxKey,
  paxUrl,
  personaKey,
  personaUrl,
  postgresUrl,
  redisUrl,
  sardineKey,
  sardineUrl,
  segmentKey,
  walletExtensionSecret,
}: {
  alchemyKey: string;
  authSecret: string;
  bridgeKey: string;
  bridgeUrl: string;
  intercomKey: string;
  mantecaKey: string;
  mantecaUrl: string;
  pandaKey: string;
  pandaUrl: string;
  paxAssociateKey: string;
  paxKey: string;
  paxUrl: string;
  personaKey: string;
  personaUrl: string;
  postgresUrl: string;
  redisUrl: string;
  sardineKey: string;
  sardineUrl: string;
  segmentKey: string;
  walletExtensionSecret: string;
}) {
  const database = drizzle(postgresUrl, { schema });
  const redis = new Redis(redisUrl);
  const bullmq = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const betterAuth = createBetterAuth(database, authSecret);
  const auth = createAuth(authSecret);
  const org = createOrg(betterAuth);
  const bridge = createBridge(bridgeKey, bridgeUrl);
  const intercom = createIntercom(intercomKey);
  const manteca = createManteca(mantecaKey, mantecaUrl);
  const panda = createPanda({ key: pandaKey, url: pandaUrl });
  const pax = createPax({ associateKey: paxAssociateKey, key: paxKey, url: paxUrl });
  const persona = createPersona(personaKey, personaUrl);
  const sardine = createSardine(sardineKey, sardineUrl);
  const segment = createSegment(segmentKey);
  const subscribe = createSubscribe(bullmq, createAlchemy(alchemyKey));
  const walletExtension = createWalletExtension(walletExtensionSecret);
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
    .route("/card", card({ auth, database, panda, pax, persona, sardine, segment, walletExtension }))
    .route("/kyc", kyc({ auth, database, panda, persona }))
    .route("/passkey", passkey({ auth, database })) // eslint-disable-line @typescript-eslint/no-deprecated -- // TODO remove
    .route("/pax", paxRoute({ auth, database, pax }))
    .route("/ramp", ramp({ auth, bridge, database, manteca, persona }))
    .route("/webhook", webhook({ betterAuth, database, org }))
    .on(["POST", "GET"], "/auth/*", (c) => betterAuth.handler(c.req.raw));
  let closing: Promise<unknown> | undefined;
  return {
    app,
    close: () =>
      (closing ??= Promise.all([
        database.$client.end(),
        redis.quit(),
        segment.close(),
        subscribe.close().finally(() => bullmq.quit()),
      ])),
    ready: Promise.resolve(),
  };
}

export type ExaAPI = ReturnType<typeof api>["app"];
