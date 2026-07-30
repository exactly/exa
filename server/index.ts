import { serveStatic } from "@hono/node-server/serve-static";
import { setExtra } from "@sentry/node";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { base } from "viem/chains";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";

import createApi from "./api";
import database from "./database";
import createActivity from "./hooks/activity";
import createBlock from "./hooks/block";
import createBridge from "./hooks/bridge";
import createManteca from "./hooks/manteca";
import createPanda from "./hooks/panda";
import createPersona from "./hooks/persona";
import supervise from "./supervise";
import androidFingerprints from "./utils/android/fingerprints";
import appOrigin from "./utils/appOrigin";
import { closeQueue as closeMaturity, reminders, setup as setupMaturity } from "./utils/maturity";
import { close as closeRedis } from "./utils/redis";
import { legacy } from "./utils/wallet";

const issuer = legacy("issuer"); // eslint-disable-line @typescript-eslint/no-deprecated -- legacy monolith
const keeper = legacy("keeper"); // eslint-disable-line @typescript-eslint/no-deprecated -- legacy monolith
setupMaturity(parse(pipe(string("onesignal"), nonEmpty("onesignal")), env.ONESIGNAL_API_KEY));
const api = createApi({
  alchemyKey: parse(pipe(string("alchemy"), nonEmpty("alchemy")), env.ALCHEMY_WEBHOOKS_KEY),
  authSecret: parse(pipe(string("auth"), nonEmpty("auth")), env.AUTH_SECRET),
  bridgeKey: parse(pipe(string("bridge key"), nonEmpty("bridge key")), env.BRIDGE_API_KEY),
  bridgeUrl: parse(pipe(string("bridge url"), nonEmpty("bridge url")), env.BRIDGE_API_URL),
  chatKey: parse(pipe(string("chat"), nonEmpty("chat")), env.CHAT_IDENTITY_KEY),
  intercomKey: parse(pipe(string("intercom"), nonEmpty("intercom")), env.INTERCOM_IDENTITY_KEY),
  mantecaKey: parse(pipe(string("manteca key"), nonEmpty("manteca key")), env.MANTECA_API_KEY),
  mantecaUrl: parse(pipe(string("manteca url"), nonEmpty("manteca url")), env.MANTECA_API_URL),
  pandaKey: parse(pipe(string("panda key"), nonEmpty("panda key")), env.PANDA_API_KEY),
  pandaUrl: parse(pipe(string("panda url"), nonEmpty("panda url")), env.PANDA_API_URL),
  paxAssociateKey: parse(pipe(string("pax associate"), nonEmpty("pax associate")), env.PAX_ASSOCIATE_ID_KEY),
  paxKey: parse(pipe(string("pax key"), nonEmpty("pax key")), env.PAX_API_KEY),
  paxUrl: parse(pipe(string("pax url"), nonEmpty("pax url")), env.PAX_API_URL),
  personaKey: parse(pipe(string("persona key"), nonEmpty("persona key")), env.PERSONA_API_KEY),
  personaUrl: parse(pipe(string("persona url"), nonEmpty("persona url")), env.PERSONA_URL),
  postgresUrl: parse(pipe(string("postgres"), nonEmpty("postgres")), env.POSTGRES_URL),
  redisUrl: parse(pipe(string("redis"), nonEmpty("redis")), env.REDIS_URL),
  sardineKey: parse(pipe(string("sardine key"), nonEmpty("sardine key")), env.SARDINE_API_KEY),
  sardineUrl: parse(pipe(string("sardine url"), nonEmpty("sardine url")), env.SARDINE_API_URL),
  segmentKey: parse(pipe(string("segment"), nonEmpty("segment")), env.SEGMENT_WRITE_KEY),
  walletExtensionSecret: parse(pipe(string("wallet"), nonEmpty("wallet")), env.WALLET_EXTENSION_SECRET),
  whatsappFrom: parse(pipe(string("whatsapp from"), nonEmpty("whatsapp from")), env.WHATSAPP_PHONE_NUMBER_ID),
  whatsappToken: parse(pipe(string("whatsapp token"), nonEmpty("whatsapp token")), env.WHATSAPP_ACCESS_TOKEN),
});

const activity = createActivity({
  alchemyKey: parse(pipe(string("alchemy"), nonEmpty("alchemy")), env.ALCHEMY_WEBHOOKS_KEY),
  activityKey: env.ALCHEMY_ACTIVITY_KEY,
  onesignalKey: parse(pipe(string("onesignal"), nonEmpty("onesignal")), env.ONESIGNAL_API_KEY),
  postgresUrl: parse(pipe(string("postgres"), nonEmpty("postgres")), env.POSTGRES_URL),
  redisUrl: parse(pipe(string("redis"), nonEmpty("redis")), env.REDIS_URL),
});
const block = createBlock({
  alchemyKey: parse(pipe(string("alchemy"), nonEmpty("alchemy")), env.ALCHEMY_WEBHOOKS_KEY),
  blockKey: env.ALCHEMY_BLOCK_KEY,
  executor: keeper,
  onesignalKey: parse(pipe(string("onesignal"), nonEmpty("onesignal")), env.ONESIGNAL_API_KEY),
  redisUrl: parse(pipe(string("redis"), nonEmpty("redis")), env.REDIS_URL),
});
const bridge = createBridge({
  bridgeKey: parse(pipe(string("bridge key"), nonEmpty("bridge key")), env.BRIDGE_API_KEY),
  bridgeUrl: parse(pipe(string("bridge url"), nonEmpty("bridge url")), env.BRIDGE_API_URL),
  bridgeWebhookKey: env.BRIDGE_WEBHOOK_PUBLIC_KEY,
  onesignalKey: parse(pipe(string("onesignal"), nonEmpty("onesignal")), env.ONESIGNAL_API_KEY),
  personaKey: parse(pipe(string("persona key"), nonEmpty("persona key")), env.PERSONA_API_KEY),
  personaUrl: parse(pipe(string("persona url"), nonEmpty("persona url")), env.PERSONA_URL),
  postgresUrl: parse(pipe(string("postgres"), nonEmpty("postgres")), env.POSTGRES_URL),
  segmentKey: parse(pipe(string("segment"), nonEmpty("segment")), env.SEGMENT_WRITE_KEY),
});
const manteca = createManteca({
  mantecaKey: parse(pipe(string("manteca key"), nonEmpty("manteca key")), env.MANTECA_API_KEY),
  mantecaUrl: parse(pipe(string("manteca url"), nonEmpty("manteca url")), env.MANTECA_API_URL),
  mantecaWebhookKey: parse(pipe(string("manteca webhook"), nonEmpty("manteca webhook")), env.MANTECA_WEBHOOKS_KEY),
  onesignalKey: parse(pipe(string("onesignal"), nonEmpty("onesignal")), env.ONESIGNAL_API_KEY),
  postgresUrl: parse(pipe(string("postgres"), nonEmpty("postgres")), env.POSTGRES_URL),
  segmentKey: parse(pipe(string("segment"), nonEmpty("segment")), env.SEGMENT_WRITE_KEY),
});
const panda = createPanda({
  issuer,
  onesignalKey: parse(pipe(string("onesignal"), nonEmpty("onesignal")), env.ONESIGNAL_API_KEY),
  pandaKey: parse(pipe(string("panda key"), nonEmpty("panda key")), env.PANDA_API_KEY),
  pandaUrl: parse(pipe(string("panda url"), nonEmpty("panda url")), env.PANDA_API_URL),
  postgresUrl: parse(pipe(string("postgres"), nonEmpty("postgres")), env.POSTGRES_URL),
  redisUrl: parse(pipe(string("redis"), nonEmpty("redis")), env.REDIS_URL),
  sardineKey: parse(pipe(string("sardine key"), nonEmpty("sardine key")), env.SARDINE_API_KEY),
  sardineUrl: parse(pipe(string("sardine url"), nonEmpty("sardine url")), env.SARDINE_API_URL),
  segmentKey: parse(pipe(string("segment"), nonEmpty("segment")), env.SEGMENT_WRITE_KEY),
  settler: keeper,
});
const persona = createPersona({
  pandaKey: parse(pipe(string("panda key"), nonEmpty("panda key")), env.PANDA_API_KEY),
  pandaUrl: parse(pipe(string("panda url"), nonEmpty("panda url")), env.PANDA_API_URL),
  paxAssociateKey: parse(pipe(string("pax associate"), nonEmpty("pax associate")), env.PAX_ASSOCIATE_ID_KEY),
  paxKey: parse(pipe(string("pax key"), nonEmpty("pax key")), env.PAX_API_KEY),
  paxUrl: parse(pipe(string("pax url"), nonEmpty("pax url")), env.PAX_API_URL),
  personaKey: parse(pipe(string("persona key"), nonEmpty("persona key")), env.PERSONA_API_KEY),
  personaUrl: parse(pipe(string("persona url"), nonEmpty("persona url")), env.PERSONA_URL),
  personaWebhookSecret: parse(pipe(string("persona hook"), nonEmpty("persona hook")), env.PERSONA_WEBHOOK_SECRET),
  postgresUrl: parse(pipe(string("postgres"), nonEmpty("postgres")), env.POSTGRES_URL),
  redisUrl: parse(pipe(string("redis"), nonEmpty("redis")), env.REDIS_URL),
  sardineKey: parse(pipe(string("sardine key"), nonEmpty("sardine key")), env.SARDINE_API_KEY),
  sardineUrl: parse(pipe(string("sardine url"), nonEmpty("sardine url")), env.SARDINE_API_URL),
});

const app = new Hono();
app.use(trimTrailingSlash());
app.route("/api", api.app);
app.route("/hooks/activity", activity.app);
app.route("/hooks/block", block.app);
app.route("/hooks/bridge", bridge.app);
app.route("/hooks/manteca", manteca.app);
app.route("/hooks/panda", panda.app);
app.route("/hooks/persona", persona.app);

app.get("/.well-known/apple-app-site-association", (c) =>
  c.json({ webcredentials: { apps: ["665NDX7LBZ.app.exactly"] } }),
);
app.get("/.well-known/assetlinks.json", (c) =>
  c.json([
    {
      relation: ["delegate_permission/common.handle_all_urls", "delegate_permission/common.get_login_creds"],
      target: {
        namespace: "android_app",
        package_name: "app.exactly",
        sha256_cert_fingerprints: androidFingerprints,
      },
    },
  ]),
);
app.get("/.well-known/farcaster.json", (c) =>
  c.json({
    miniapp: {
      version: "1",
      homeUrl: appOrigin,
      canonicalDomain: domain,
      name: "Exa App",
      ogTitle: "Exa App",
      tagline: "What finance should be today",
      subtitle: "What finance should be today",
      description: "A Card. A Wallet. A DeFi Protocol. All of it together.",
      ogDescription: "A Card. A Wallet. A DeFi Protocol. All of it together.",
      buttonTitle: "Get your card",
      iconUrl: `${appOrigin}/assets/src/assets/icon.ee8db558f86485a670692d730dc29e85.png`,
      imageUrl: "https://assets.exactly.app/miniapp-image.webp",
      ogImageUrl: "https://assets.exactly.app/og-image.webp",
      heroImageUrl: "https://assets.exactly.app/og-image.webp",
      splashImageUrl: "https://assets.exactly.app/miniapp-splash.webp",
      splashBackgroundColor: "#FBFDFC",
      requiredChains: [`eip155:${chain.id}`],
      primaryCategory: "finance",
      tags: ["defi", "card", "yield", "credit", "earn"],
      noindex: chain.id !== base.id,
    },
    accountAssociation: {
      header: isoBase64URL.fromUTF8String(
        `{"fid":1331679,"type":"custody","key":"0x5041Ec4691686c5756249deC0A08A3F00605B1b5"}`,
      ),
      payload: isoBase64URL.fromUTF8String(`{"domain":"${domain}"}`),
      signature: {
        "web.exactly.app":
          "MHg1NDJkZTQ0ZGNkOThlMTBmMGI4NWMwY2I4YjU0ODliNTBlYWViYWY2YzE1YTk3NGVkNzk4NTY4ZmE2NDhiY2M2MDhlNWQ4NzliYTQ5M2E3NjhiMmQzYmM0YWZkN2U0ODNkMjQ1MDkxM2RjZDdlNTIzZWRhMzRkN2VlYjc0NmQ3ZjFi",
        "sandbox.exactly.app":
          "MHhiMzMwY2QyN2Y4NDFkNjQ4NzZmNmI2OTMyYzY0YWExMjljNGQ5MWM4OTkyNjM0NzY4MzhhMzE5YmRhMzcxMmZjMjE2NzdiZjdlZTJkZDE5MDc5MmUzNzYwZjc1Yzg3NmVkMmQ5YmRhZTdhZjg5MzVmMTgyNDdlYzBkNzg3MzI4OTFj",
      }[domain],
    },
    baseBuilder: { allowedAddresses: ["0xCc6565b0222f59102291B94b0D4F8292038811C5"] },
  }),
);

const frontend = new Hono();
frontend.use((_, next) => {
  setExtra("exa.ignore", true);
  return next();
});
const reportUri = `https://o1351734.ingest.us.sentry.io/api/4506186349674496/security/?sentry_key=ac8875331e4cecd67dd0a7519a36dfeb&sentry_environment=${
  { "web.exactly.app": "production" }[domain] ?? /^(.+)\.exactly\.app$/.exec(domain)?.[1] ?? domain
}`;
frontend.use(
  "/assets/*",
  secureHeaders({
    xFrameOptions: false,
    referrerPolicy: "strict-origin-when-cross-origin",
    crossOriginResourcePolicy: "cross-origin",
  }),
);
frontend.use(
  secureHeaders({
    xFrameOptions: false,
    referrerPolicy: "strict-origin-when-cross-origin",
    reportingEndpoints: [{ name: "sentry", url: reportUri }],
    contentSecurityPolicyReportOnly: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://onesignal.com"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://api.onesignal.com",
        "https://cdn.onesignal.com",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "'unsafe-eval'",
        "https://app.intercom.io",
        "https://widget.intercom.io",
        "https://js.intercomcdn.com",
        // #endregion
      ],
      connectSrc: [
        "'self'",
        "https://li.quest",
        "https://*.g.alchemy.com",
        "https://assets.smold.app",
        "https://api.onesignal.com",
        "https://cdn.onesignal.com",
        "https://*.ingest.us.sentry.io",
        "https://raw.githubusercontent.com",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "https://via.intercom.io",
        "https://api.intercom.io",
        "https://api.au.intercom.io",
        "https://api.eu.intercom.io",
        "https://api-iam.intercom.io",
        "https://api-iam.eu.intercom.io",
        "https://api-iam.au.intercom.io",
        "https://api-ping.intercom.io",
        "https://*.intercom-messenger.com",
        "wss://*.intercom-messenger.com",
        "https://nexus-websocket-a.intercom.io",
        "wss://nexus-websocket-a.intercom.io",
        "https://nexus-websocket-b.intercom.io",
        "wss://nexus-websocket-b.intercom.io",
        "https://nexus-europe-websocket.intercom.io",
        "wss://nexus-europe-websocket.intercom.io",
        "https://nexus-australia-websocket.intercom.io",
        "wss://nexus-australia-websocket.intercom.io",
        "https://uploads.intercomcdn.com",
        "https://uploads.intercomcdn.eu",
        "https://uploads.au.intercomcdn.com",
        "https://uploads.eu.intercomcdn.com",
        "https://uploads.intercomusercontent.com",
        // #endregion
      ],
      childSrc: [
        "'self'",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "https://intercom-sheets.com",
        "https://www.intercom-reporting.com",
        "https://www.youtube.com",
        "https://player.vimeo.com",
        "https://fast.wistia.net",
        // #endregion
      ],
      fontSrc: [
        "'self'",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "https://fonts.intercomcdn.com",
        "https://js.intercomcdn.com",
        // #endregion
      ],
      formAction: [
        "'self'",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "https://intercom.help",
        "https://api-iam.intercom.io",
        "https://api-iam.eu.intercom.io",
        "https://api-iam.au.intercom.io",
        // #endregion
      ],
      mediaSrc: [
        "'self'",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "https://js.intercomcdn.com",
        "https://downloads.intercomcdn.com",
        "https://downloads.intercomcdn.eu",
        "https://downloads.au.intercomcdn.com",
        // #endregion
      ],
      imgSrc: [
        "'self'",
        "blob:",
        "data:",
        "https://app.exact.ly",
        "https://assets.exactly.app",
        "https://static.debank.com",
        "https://storage.googleapis.com",
        "https://optimistic.etherscan.io",
        "https://raw.githubusercontent.com",
        "https://avatars.githubusercontent.com",
        // #region intercom https://www.intercom.com/help/en/articles/3894-using-intercom-with-content-security-policy
        "https://js.intercomcdn.com",
        "https://static.intercomassets.com",
        "https://downloads.intercomcdn.com",
        "https://downloads.intercomcdn.eu",
        "https://downloads.au.intercomcdn.com",
        "https://uploads.intercomusercontent.com",
        "https://gifs.intercomcdn.com",
        "https://video-messages.intercomcdn.com",
        "https://messenger-apps.intercom.io",
        "https://messenger-apps.eu.intercom.io",
        "https://messenger-apps.au.intercom.io",
        "https://*.intercom-attachments-1.com",
        "https://*.intercom-attachments.eu",
        "https://*.au.intercom-attachments.com",
        "https://*.intercom-attachments-2.com",
        "https://*.intercom-attachments-3.com",
        "https://*.intercom-attachments-4.com",
        "https://*.intercom-attachments-5.com",
        "https://*.intercom-attachments-6.com",
        "https://*.intercom-attachments-7.com",
        "https://*.intercom-attachments-8.com",
        "https://*.intercom-attachments-9.com",
        "https://static.intercomassets.eu",
        "https://static.au.intercomassets.com",
        // #endregion
      ],
      frameAncestors: [
        "https://farcaster.xyz",
        "https://base.app",
        "https://base.org",
        "https://base.dev",
        "https://*.base.app",
        "https://*.base.org",
        "https://*.base.dev",
      ],
      scriptSrcAttr: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'none'"],
      reportTo: "sentry",
      reportUri,
    },
  }),
);
frontend.use(
  serveStatic({
    root: "app",
    rewriteRequestPath: (path) => {
      const basePath = (path.split("?")[0] ?? "").split("#")[0] ?? "";
      return basePath === "/" ||
        basePath.endsWith("/") ||
        (/\.[^./]+$/.test(basePath) && basePath.lastIndexOf(".") > basePath.lastIndexOf("/"))
        ? path
        : `${basePath}.html`;
    },
  }),
);
frontend.use(
  serveStatic({
    root: "app",
    rewriteRequestPath: (path) => {
      const basePath = (path.split("?")[0] ?? "").split("#")[0] ?? "";
      return basePath === "/" ||
        basePath.endsWith("/") ||
        (/\.[^./]+$/.test(basePath) && basePath.lastIndexOf(".") > basePath.lastIndexOf("/"))
        ? path
        : `${basePath}/`;
    },
  }),
);
app.route("/", frontend);

export default app;

export const close = supervise(
  "server",
  Promise.resolve({
    app,
    ready: Promise.all([
      api.ready,
      activity.ready,
      block.ready,
      bridge.ready,
      manteca.ready,
      panda.ready,
      persona.ready,
      reminders().catch(reminders),
    ]),
    async close() {
      const services = await Promise.allSettled([
        api.close(),
        database.$client.end(),
        activity.close(),
        block.close(),
        bridge.close(),
        manteca.close(),
        panda.close(),
        persona.close(),
        closeMaturity().finally(closeRedis),
      ]);
      if (services.some((service) => service.status === "rejected")) throw new Error("closing services failed");
    },
  }),
);
