import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { captureException, close } from "@sentry/node";
import { Hono } from "hono";
import { trimTrailingSlash } from "hono/trailing-slash";
import type { UnofficialStatusCode } from "hono/utils/http-status";

import api from "./api";
import activityHook from "./hooks/activity";
import block from "./hooks/block";
import panda from "./hooks/panda";
import persona from "./hooks/persona";
import androidFingerprints from "./utils/android/fingerprints";
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
