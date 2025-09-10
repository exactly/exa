import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { captureException, close as closeSentry } from "@sentry/node";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { trimTrailingSlash } from "hono/trailing-slash";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";

import api from "./api";
import database from "./database";
import activityHook from "./hooks/activity";
import block from "./hooks/block";
import manteca from "./hooks/manteca";
import panda from "./hooks/panda";
import persona from "./hooks/persona";
import androidFingerprints from "./utils/android/fingerprints";
import appOrigin from "./utils/appOrigin";
import auth from "./utils/auth";
import { closeAndFlush as closeSegment } from "./utils/segment";

import type { UnofficialStatusCode } from "hono/utils/http-status";

const app = new Hono();
app.use(trimTrailingSlash());

app.route("/api", api);

app.route("/hooks/activity", activityHook);
app.route("/hooks/block", block);
app.route("/hooks/manteca", manteca);
app.route("/hooks/panda", panda);
app.route("/hooks/persona", persona);

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

app.onError((error, c) => {
  let fingerprint: string[] | undefined;
  if (error instanceof Error) {
    const message = error.message
      .split("Error:")
      .reduce((result, part) => (result ? `${result}Error:${part}` : part.trimStart()), "");
    const status = message.slice(0, 3);
    const hasStatus = /^\d{3}$/.test(status);
    const hasBodyFormat = message.length === 3 || message[3] === " ";
    const body = hasBodyFormat && message.length > 3 ? message.slice(4).trim() : undefined;
    if (hasStatus && hasBodyFormat) fingerprint = ["{{ default }}", status];
    if (hasStatus && hasBodyFormat && body) {
      try {
        const json = JSON.parse(body) as { code?: unknown; error?: unknown; message?: unknown };
        fingerprint = [
          "{{ default }}",
          status,
          ...("code" in json
            ? [String(json.code)]
            : typeof json.message === "string"
              ? [json.message]
              : typeof json.error === "string"
                ? [json.error]
                : [body]),
        ];
      } catch {
        fingerprint = ["{{ default }}", status, body];
      }
    }
  }
  captureException(error, { level: "error", tags: { unhandled: true }, fingerprint });
  return c.json({ code: "unexpected error", legacy: "unexpected error" }, 555 as UnofficialStatusCode);
});

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

export default app;

const server = serve(app);

export async function close() {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      Promise.allSettled([closeSentry(), closeSegment(), database.$client.end()])
        .then((results) => {
          if (error) reject(error);
          else if (results.some((result) => result.status === "rejected")) reject(new Error("closing services failed"));
          else resolve(null);
        })
        .catch(reject);
    });
  });
}

if (!process.env.VITEST) {
  ["SIGINT", "SIGTERM"].map((code) => {
    process.on(code, () => {
      close()
        .then(() => process.exit(0)) // eslint-disable-line n/no-process-exit
        .catch(() => process.exit(1)); // eslint-disable-line n/no-process-exit
    });
  });
}
