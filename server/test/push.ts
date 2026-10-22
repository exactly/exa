import { randomUUID } from "node:crypto";
import { array, boolean, looseObject, number, object, optional, parse, string, unknown } from "valibot";

import appOrigin from "../utils/appOrigin";

import type createOnesignal from "../utils/onesignal";

export default async function push({
  userId,
  headings,
  contents,
}: Parameters<ReturnType<typeof createOnesignal>["sendPushNotification"]>[0]) {
  const page = await (session ??= connect().catch((error: unknown) => {
    session = undefined;
    throw error;
  })).catch(() => undefined);
  if (!page) return { id: "" };
  const subscriber = parse(
    object({ result: object({ value: object({ externalId: optional(string()), optedIn: optional(boolean()) }) }) }),
    await page.send("Runtime.evaluate", {
      expression:
        "({ externalId: window.OneSignal?.User.externalId, optedIn: window.OneSignal?.User.PushSubscription.optedIn })",
      returnByValue: true,
    }),
  ).result.value;
  const registrationId = [...page.registrations].find(([, scope]) => scope.startsWith(appOrigin))?.[0];
  if (subscriber.externalId !== userId || !subscriber.optedIn || !registrationId) return { id: "" };
  const id = randomUUID();
  await page.send("ServiceWorker.deliverPushMessage", {
    origin: appOrigin,
    registrationId,
    data: JSON.stringify({ custom: { i: id }, title: headings.en, alert: contents.en }),
  });
  return { id };
}

let session: Promise<Awaited<ReturnType<typeof connect>>> | undefined;

async function connect() {
  const target = parse(
    array(looseObject({ type: string(), url: string(), webSocketDebuggerUrl: string() })),
    await fetch("http://127.0.0.1:9222/json/list").then((response) => response.json()),
  ).find(({ type, url }) => type === "page" && url.startsWith(appOrigin));
  if (!target) throw new Error("no app page");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map<number, { reject: (error: Error) => void; resolve: (result: unknown) => void }>();
  const registrations = new Map<string, string>();
  socket.addEventListener("message", ({ data }) => {
    const message = parse(
      looseObject({
        id: optional(number()),
        method: optional(string()),
        params: optional(unknown()),
        result: optional(unknown()),
        error: optional(object({ message: string() })),
      }),
      JSON.parse(String(data)),
    );
    if (message.id !== undefined) {
      const callbacks = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callbacks?.reject(new Error(message.error.message));
      else callbacks?.resolve(message.result);
      return;
    }
    if (message.method !== "ServiceWorker.workerRegistrationUpdated") return;
    for (const { registrationId, scopeURL, isDeleted } of parse(
      object({ registrations: array(object({ registrationId: string(), scopeURL: string(), isDeleted: boolean() })) }),
      message.params,
    ).registrations) {
      if (isDeleted) registrations.delete(registrationId);
      else registrations.set(registrationId, scopeURL);
    }
  });
  socket.addEventListener("close", () => {
    session = undefined;
    for (const { reject } of pending.values()) reject(new Error("devtools closed"));
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  function send(method: string, params: Record<string, unknown> = {}) {
    return new Promise<unknown>((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }
  await send("ServiceWorker.enable");
  return { send, registrations };
}
