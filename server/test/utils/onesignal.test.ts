import { v5 } from "uuid";
import { describe, expect, it, vi } from "vitest";

import createOnesignal from "../../utils/onesignal";

import type { Notification } from "@onesignal/node-onesignal";

const mocks = vi.hoisted(() => ({
  createConfiguration: vi.fn(),
  createNotification: vi.fn<(notification: Notification) => Promise<unknown>>(),
}));

vi.mock("@onesignal/node-onesignal", async (importOriginal) => ({
  ...(await importOriginal()),
  createConfiguration: mocks.createConfiguration,
  DefaultApi: class {
    createNotification = mocks.createNotification;
  },
}));

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[89ab][\da-f]{3}-[\da-f]{12}$/u;
const firstApp = "2f79a35c-8b11-4725-84d8-fc096f3f216e";
const secondApp = "31d4be98-1fa3-4a8c-9657-dc21c991adc7";
const apps = JSON.stringify({ [firstApp]: "secret" });

describe("onesignal", () => {
  it("sends a notification", async () => {
    const response = {};
    mocks.createNotification.mockResolvedValueOnce(response);
    const onesignal = createOnesignal(apps);

    await expect(
      onesignal.sendPushNotification({
        userId: "user",
        headings: { en: "heading" },
        contents: { en: "content" },
        idempotencyKey: "idempotency",
        ttl: 3600,
      }),
    ).resolves.toStrictEqual([response]);

    expect(mocks.createConfiguration).toHaveBeenCalledExactlyOnceWith({ restApiKey: "secret" });
    expect(mocks.createNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        app_id: firstApp,
        target_channel: "push",
        include_aliases: { external_id: ["user"] },
        headings: { en: "heading" },
        contents: { en: "content" },
        idempotency_key: v5("idempotency", firstApp),
        ttl: 3600,
      }),
    );
  });

  it("omits ttl when not set", async () => {
    const onesignal = createOnesignal(apps);

    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "heading" },
      contents: { en: "content" },
      idempotencyKey: "idempotency",
    });

    expect(mocks.createNotification.mock.lastCall?.[0].idempotency_key).toBe(v5("idempotency", firstApp));
    expect(mocks.createNotification.mock.lastCall?.[0]).not.toHaveProperty("ttl");
  });

  it("stacks notifications without a topic", async () => {
    const onesignal = createOnesignal(apps);

    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "a" },
      contents: { en: "a" },
      idempotencyKey: "a",
    });
    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "b" },
      contents: { en: "b" },
      idempotencyKey: "b",
    });

    const [first, second] = mocks.createNotification.mock.calls.slice(-2).map(([notification]) => notification);
    expect(first?.web_push_topic).toMatch(uuid);
    expect(second?.web_push_topic).toMatch(uuid);
    expect(first?.web_push_topic).not.toBe(second?.web_push_topic);
    expect(first).not.toHaveProperty("collapse_id");
    expect(second).not.toHaveProperty("collapse_id");
  });

  it("replaces notifications sharing a topic on web and mobile", async () => {
    const onesignal = createOnesignal(apps);

    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "a" },
      contents: { en: "a" },
      idempotencyKey: "a",
      topic: "t/1",
    });
    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "b" },
      contents: { en: "b" },
      idempotencyKey: "b",
      topic: "t/1",
    });
    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "c" },
      contents: { en: "c" },
      idempotencyKey: "c",
      topic: "t/2",
    });

    const [first, second, other] = mocks.createNotification.mock.calls.slice(-3).map(([notification]) => notification);
    expect(first?.web_push_topic).toMatch(uuid);
    expect(first?.collapse_id).toBe(first?.web_push_topic);
    expect(second?.web_push_topic).toBe(first?.web_push_topic);
    expect(second?.collapse_id).toBe(first?.collapse_id);
    expect(other?.web_push_topic).not.toBe(first?.web_push_topic);
    expect(other?.collapse_id).toBe(other?.web_push_topic);
  });

  it("sends to every app with its own key", async () => {
    mocks.createConfiguration.mockClear();
    mocks.createNotification.mockClear();
    const onesignal = createOnesignal(JSON.stringify({ [firstApp]: "a", [secondApp]: "b" }));

    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "a" },
      contents: { en: "a" },
      idempotencyKey: "a",
      topic: "t/1",
    });

    expect(mocks.createConfiguration.mock.calls).toStrictEqual([[{ restApiKey: "a" }], [{ restApiKey: "b" }]]);
    const [first, second] = mocks.createNotification.mock.calls.map(([notification]) => notification);
    expect(first?.app_id).toBe(firstApp);
    expect(second?.app_id).toBe(secondApp);
    expect(first?.idempotency_key).toBe(v5("a", firstApp));
    expect(second?.idempotency_key).toBe(v5("a", secondApp));
    expect(second?.web_push_topic).toBe(first?.web_push_topic);
    expect(second?.collapse_id).toBe(first?.collapse_id);
  });

  it("sends to the other apps when one fails", async () => {
    mocks.createNotification.mockClear();
    const error = new Error("onesignal");
    mocks.createNotification.mockRejectedValueOnce(error);
    const onesignal = createOnesignal(JSON.stringify({ [firstApp]: "a", [secondApp]: "b" }));

    await expect(
      onesignal.sendPushNotification({
        userId: "user",
        headings: { en: "a" },
        contents: { en: "a" },
        idempotencyKey: "a",
      }),
    ).rejects.toStrictEqual(new Error(`onesignal ${firstApp}`, { cause: error }));
    expect(mocks.createNotification).toHaveBeenCalledTimes(2);
  });

  it("aggregates errors from many apps", async () => {
    const errors = [new Error("a"), new Error("b")];
    mocks.createNotification.mockRejectedValueOnce(errors[0]).mockRejectedValueOnce(errors[1]);
    const onesignal = createOnesignal(JSON.stringify({ [firstApp]: "a", [secondApp]: "b" }));

    await expect(
      onesignal.sendPushNotification({
        userId: "user",
        headings: { en: "a" },
        contents: { en: "a" },
        idempotencyKey: "a",
      }),
    ).rejects.toStrictEqual(
      new AggregateError(
        [
          new Error(`onesignal ${firstApp}`, { cause: errors[0] }),
          new Error(`onesignal ${secondApp}`, { cause: errors[1] }),
        ],
        "onesignal",
      ),
    );
  });

  it.each([
    ["onesignal"],
    ["{}"],
    ['{"app":"key"}'],
    ['{"2f79a35c-8b11-0725-04d8-fc096f3f216e":"key"}'],
    [JSON.stringify({ [firstApp]: "" })],
  ])("rejects invalid apps %s", (invalid) => {
    expect(() => createOnesignal(invalid)).toThrow(new Error("invalid onesignal apps"));
  });
});
