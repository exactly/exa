import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { captureException, close } from "@sentry/node";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import type { UnofficialStatusCode } from "hono/utils/http-status";

import appMetadata from "../package.json";
import api from "./api";
import activityHook from "./hooks/activity";
import block from "./hooks/block";
import panda from "./hooks/panda";
import persona from "./hooks/persona";
import androidFingerprints from "./utils/android/fingerprints";
import appOrigin from "./utils/appOrigin";
import { closeAndFlush } from "./utils/segment";

const app = new Hono();
app.use(trimTrailingSlash());

app.route("/api", api);

app.route("/hooks/activity", activityHook);
app.route("/hooks/block", block);
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
      name: appMetadata.title,
      ogTitle: appMetadata.title,
      tagline: appMetadata.shortDescription,
      subtitle: appMetadata.shortDescription,
      description: appMetadata.description,
      ogDescription: appMetadata.description,
      buttonTitle: "Get your card",
      imageUrl: "https://exactly.app/og-image.webp",
      ogImageUrl: "https://exactly.app/og-image.webp",
      iconUrl: `${appOrigin}/assets/src/assets/icon.f9538ae2aa18c66272006c460191b34f.png`,
      splashImageUrl: `${appOrigin}/assets/src/assets/icon.f9538ae2aa18c66272006c460191b34f.png`,
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
  }),
);
app.use(
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
app.use(
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

app.onError((error, c) => {
  captureException(error, { level: "error", tags: { unhandled: true } });
  return c.json({ code: "unexpected error", legacy: "unexpected error" }, 555 as UnofficialStatusCode);
});

const server = serve(app);

["SIGINT", "SIGTERM"].map((code) =>
  process.on(code, () =>
    server.close((error) => {
      Promise.allSettled([close(), closeAndFlush()])
        .then((results) => {
          process.exit(error || results.some((result) => result.status === "rejected") ? 1 : 0); // eslint-disable-line n/no-process-exit
        })
        .catch(() => undefined);
    }),
  ),
);
