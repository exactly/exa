#!/usr/bin/env node
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { serve, upgradeWebSocket } from "@hono/node-server";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { env } from "node:process";
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
        options.args = [...(options.args ?? []), "--force-prefers-reduced-motion"];
        if (browserPath?.includes("brave"))
          options.prefs = { ...options.prefs, "brave.sidebar.sidebar_show_option": 3 }; // cspell:ignore prefs
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
      if (options?.debuggerAddress) {
        if (browserPath?.includes("brave")) await wallet(options.debuggerAddress);
        options.debuggerAddress = `127.0.0.1:${await devtools(options.debuggerAddress)}`;
      }
      return c.json(session);
    })
    .post("/session/:id/actions", async (c) => {
      const request = await c.req.json<{ actions: { actions: Action[]; parameters?: { pointerType?: string } }[] }>();
      const [touch, ...others] = request.actions;
      if (
        others.length > 0 ||
        touch?.parameters?.pointerType !== "touch" ||
        touch.actions.some(({ type, origin }) => type === "pointerMove" && origin !== "viewport")
      ) {
        return post(c.req.path, request);
      }
      let time = Date.now();
      let point = { x: 0, y: 0 };
      let down = false;
      for (const action of touch.actions) {
        if (action.type === "pause") time += action.duration ?? 0;
        if (action.type === "pointerDown" || action.type === "pointerUp") {
          down = action.type === "pointerDown";
          await dispatch(down ? "touchStart" : "touchEnd", down ? [point] : []);
        }
        if (action.type !== "pointerMove") continue;
        const start = point;
        const steps = Math.max(1, Math.round((action.duration ?? 0) / 16));
        for (let step = 1; step <= steps; step++) {
          time += (action.duration ?? 0) / steps;
          point = {
            x: start.x + ((action.x - start.x) * step) / steps,
            y: start.y + ((action.y - start.y) * step) / steps,
          };
          if (down) await dispatch("touchMove", [point]);
        }
      }
      return c.json({ value: null });

      async function dispatch(type: string, touchPoints: { x: number; y: number }[]) {
        await sleep(time - Date.now());
        const response = await post(`/session/${c.req.param("id")}/goog/cdp/execute`, {
          cmd: "Input.dispatchTouchEvent",
          params: { type, touchPoints, timestamp: time / 1000 },
        });
        if (!response.ok) throw new Error(await response.text());
      }
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

async function wallet(chrome: string) {
  const { webSocketDebuggerUrl } = (await fetch(`http://${chrome}/json/version`).then((r) => r.json())) as {
    webSocketDebuggerUrl: string;
  };
  const browser = new WebSocket(webSocketDebuggerUrl);
  await once(browser, "open");
  let id = 0;
  const calls = new Map<number, (result: Record<string, unknown>) => void>();
  const panels = new Set<string>();
  browser.on("message", (data: Buffer) => {
    const message = JSON.parse(String(data)) as {
      id?: number;
      method?: string;
      params?: { targetId?: string; targetInfo?: { targetId: string; url: string } };
      result?: Record<string, unknown>;
    };
    if (message.id !== undefined) {
      calls.get(message.id)?.(message.result ?? {});
      calls.delete(message.id);
    }
    if (message.method === "Target.targetDestroyed" && message.params?.targetId) panels.delete(message.params.targetId);
    const target = message.params?.targetInfo;
    if (target?.url.startsWith("chrome://wallet-panel") && !panels.has(target.targetId)) {
      panels.add(target.targetId);
      approve(target.targetId).catch(() => panels.delete(target.targetId));
    }
  });
  const send = (method: string, params: object = {}, sessionId?: string) =>
    new Promise<Record<string, unknown>>((resolve) => {
      calls.set(++id, resolve);
      browser.send(JSON.stringify({ id, method, params, sessionId }));
    });
  await send("Target.setDiscoverTargets", { discover: true });
  const { targetId } = (await send("Target.createTarget", { url: "brave://wallet/" })) as { targetId: string };
  const page = await attach(targetId);
  for (const step of [
    "Already have a wallet",
    "Ethereum/Solana",
    "checkbox:0",
    "checkbox:1",
    "Continue",
    "Continue with",
  ]) {
    await tap(page, step);
  }
  const mnemonic = env.EXPO_PUBLIC_E2E_MNEMONIC || "test test test test test test test test test test test junk"; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  for (const [index, word] of mnemonic.split(" ").entries()) {
    await tap(page, `input:Word #${index + 1}`);
    await send("Input.insertText", { text: word }, page);
  }
  await tap(page, "Continue!");
  for (const placeholder of ["Enter new password", "Re-enter password"]) {
    await tap(page, `input:${placeholder}`);
    await send("Input.insertText", { text: "exa-e2e-wallet" }, page);
  }
  await tap(page, "Continue!");
  await tap(page, "Go to portfolio");
  await send("Target.closeTarget", { targetId });

  async function attach(target: string) {
    const { sessionId } = await send("Target.attachToTarget", { targetId: target, flatten: true });
    return sessionId as string;
  }

  async function tap(sessionId: string, match: string, timeout = 30_000) {
    for (const deadline = Date.now() + timeout; Date.now() < deadline; await sleep(200)) {
      const { result } = (await send(
        "Runtime.evaluate",
        { expression: `(${String(find)})(${JSON.stringify(match)})`, returnByValue: true },
        sessionId,
      )) as { result?: { value?: { x: number; y: number } } };
      if (!result?.value) continue;
      for (const type of ["mousePressed", "mouseReleased"]) {
        await send("Input.dispatchMouseEvent", { type, ...result.value, button: "left", clickCount: 1 }, sessionId);
      }
      await sleep(500);
      return;
    }
    throw new Error(`missing ${match}`);
  }

  async function approve(target: string) {
    const sessionId = await attach(target);
    while (panels.has(target)) {
      const before = await text(sessionId);
      if (
        !(await tap(sessionId, "panel", 60_000).then(
          () => true,
          () => false,
        ))
      )
        break;
      while (panels.has(target) && (await text(sessionId)) === before) await sleep(200);
    }
  }

  async function text(sessionId: string) {
    const { result } = (await send(
      "Runtime.evaluate",
      { expression: "document.body.textContent", returnByValue: true },
      sessionId,
    )) as { result?: { value?: string } };
    return result?.value;
  }
}

function find(match: string) {
  const elements: Element[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll("*")) {
      elements.push(element);
      if (element.shadowRoot) walk(element.shadowRoot);
    }
  };
  walk(document);
  const buttons = elements
    .filter((element) => {
      const { width, height } = element.getBoundingClientRect();
      return (
        ["BUTTON", "LEO-BUTTON"].includes(element.tagName) &&
        width > 0 &&
        height > 0 &&
        !(element as Element & { isDisabled?: boolean }).isDisabled
      );
    })
    .map((element) => ({ element, label: element.textContent.trim() }));
  const [kind, value = ""] = match.includes(":") ? match.split(/:(.*)/) : ["button", match];
  const target =
    kind === "checkbox"
      ? elements.filter((element) => element.getAttribute("role") === "checkbox")[Number(value)]?.firstElementChild
      : kind === "input"
        ? elements.find((element) => element instanceof HTMLInputElement && element.placeholder === value)
        : match === "panel"
          ? document.body.textContent.includes("Connect wallet") && !buttons.some(({ label }) => label === "Connect")
            ? (
                buttons.find(({ label }) => label === "Next") ??
                buttons.find(({ label }) => label.startsWith("Account 1"))
              )?.element
            : buttons.find(({ label }) =>
                ["Connect", "Approve", "Switch network", "Sign", "Sign in", "Confirm"].includes(label),
              )?.element
          : match.endsWith("!")
            ? buttons.find(({ label }) => label === match.slice(0, -1))?.element
            : buttons.find(({ label }) => label.includes(match))?.element;
  if (!target) return null;
  target.scrollIntoView({ block: "nearest" });
  const { x, y, width, height } = target.getBoundingClientRect();
  return { x: x + width / 2, y: y + height / 2 };
}

function post(path: string, body: unknown) {
  return fetch(`http://localhost:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Action = { duration?: number; origin?: unknown; type: string; x: number; y: number };

type Capabilities = Record<
  string,
  undefined | { args?: string[]; binary?: string; debuggerAddress?: string; prefs?: Record<string, unknown> }
>;
