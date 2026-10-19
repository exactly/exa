#!/usr/bin/env node
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { Options } from "selenium-webdriver/chrome.js";
import { getBinaryPaths } from "selenium-webdriver/common/driverFinder.js";
import { WebSocket, WebSocketServer } from "ws";

import type { WSContext } from "hono/ws";
import type { AddressInfo } from "node:net";

const { browserPath, driverPath } = getBinaryPaths(new Options());
const probe = createServer().listen(0);
await once(probe, "listening");
const { port } = probe.address() as AddressInfo;
probe.close();
const driver = spawn(
  driverPath,
  [...process.argv.slice(2).filter((argument) => !argument.startsWith("--port=")), `--port=${port}`],
  { stdio: "inherit" },
);
driver.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGTERM", () => driver.kill());
process.on("exit", () => driver.kill());

serve({
  hostname: "127.0.0.1",
  port: Number(process.argv.find((argument) => argument.startsWith("--port="))?.slice(7)),
  fetch: new Hono()
    .post("/session", async (c) => {
      const request = await c.req.json<{ capabilities: { alwaysMatch?: Capabilities; firstMatch?: Capabilities[] } }>();
      for (const capabilities of [request.capabilities.alwaysMatch, ...(request.capabilities.firstMatch ?? [])]) {
        const options = capabilities?.["goog:chromeOptions"];
        if (!options) continue;
        if (browserPath) options.binary ??= browserPath;
        options.args = [...(options.args ?? []), "--ignore-certificate-errors"];
      }
      const response = await post("/session", request);
      if (!response.ok) return response;
      const session = (await response.json()) as { value: { capabilities: Capabilities; sessionId: string } };
      const authenticator = await post(`/session/${session.value.sessionId}/webauthn/authenticator`, {
        protocol: "ctap2", // cspell:ignore ctap
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        defaultBackupEligibility: true,
        defaultBackupState: true,
      });
      if (!authenticator.ok) return authenticator;
      const options = session.value.capabilities["goog:chromeOptions"];
      if (options?.debuggerAddress) options.debuggerAddress = `127.0.0.1:${await devtools(options.debuggerAddress)}`;
      return c.json(session);
    })
    .all("*", (c) => proxy(`http://localhost:${port}${c.req.path}`, c.req.raw)).fetch,
});

async function devtools(chrome: string) {
  const pages = new Map<string, Promise<WebSocket>>();
  const pending = new Map<number, WSContext>();
  const server = serve({
    hostname: "127.0.0.1",
    port: 0,
    websocket: { server: new WebSocketServer({ noServer: true }) },
    serverOptions: { shouldUpgradeCallback: (request) => request.headers.upgrade?.toLowerCase() === "websocket" },
    fetch: new Hono()
      .get(
        "/devtools/page/:id",
        upgradeWebSocket((c) => {
          const page = pages.get(c.req.path) ?? connect(c.req.path);
          return {
            onMessage({ data }, socket) {
              if (typeof data !== "string") return;
              const { id } = JSON.parse(data) as { id: number };
              pending.set(id, socket);
              page
                .then((upstream) => upstream.send(data))
                .catch((error: unknown) => {
                  pending.delete(id);
                  socket.send(
                    JSON.stringify({ id, error: { code: -32_000, message: `${c.req.path}: ${String(error)}` } }),
                  );
                });
            },
          };
        }),
      )
      .get("*", async (c) => {
        const response = await fetch(`http://${chrome}${c.req.path}`);
        const body = await response.text();
        return new Response(
          body.split(`ws://${chrome}/devtools/page/`).join(`ws://${new URL(c.req.url).host}/devtools/page/`),
          { status: response.status, headers: { "content-type": "application/json" } },
        );
      }).fetch,
  });
  await once(server, "listening");
  return (server.address() as AddressInfo).port;

  function connect(path: string) {
    const upstream = new WebSocket(`ws://${chrome}${path}`);
    upstream.on("message", (data: Buffer) => {
      const { id } = JSON.parse(String(data)) as { id?: number };
      if (id === undefined) return;
      pending.get(id)?.send(String(data));
      pending.delete(id);
    });
    upstream.on("close", () => pages.delete(path));
    upstream.on("error", (error) => console.error(path, error)); // eslint-disable-line no-console -- driver output, shown in ci
    const page = once(upstream, "open").then(() => upstream);
    page.catch(() => pages.delete(path));
    pages.set(path, page);
    return page;
  }
}

function post(path: string, body: unknown) {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

type Capabilities = Record<string, undefined | { args?: string[]; binary?: string; debuggerAddress?: string }>;
