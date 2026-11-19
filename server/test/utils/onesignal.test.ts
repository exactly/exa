import { describe, expect, it, vi } from "vitest";

import appId from "@exactly/common/onesignalAppId.web";

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

describe("onesignal", () => {
  it("sends a notification", async () => {
    const response = {};
    mocks.createNotification.mockResolvedValueOnce(response);
    const onesignal = createOnesignal("secret");

    await expect(
      onesignal.sendPushNotification({
        userId: "user",
        headings: { en: "heading" },
        contents: { en: "content" },
        idempotencyKey: "idempotency",
        ttl: 3600,
      }),
    ).resolves.toBe(response);

    expect(mocks.createConfiguration).toHaveBeenCalledExactlyOnceWith({ restApiKey: "secret" });
    expect(mocks.createNotification).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        app_id: appId,
        target_channel: "push",
        include_aliases: { external_id: ["user"] },
        headings: { en: "heading" },
        contents: { en: "content" },
        idempotency_key: "idempotency",
        ttl: 3600,
      }),
    );
  });

  it("omits optional delivery options", async () => {
    const onesignal = createOnesignal("secret");

    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "heading" },
      contents: { en: "content" },
    });

    expect(mocks.createNotification.mock.lastCall?.[0]).not.toHaveProperty("idempotency_key");
    expect(mocks.createNotification.mock.lastCall?.[0]).not.toHaveProperty("ttl");
  });

  it("stacks notifications without a topic", async () => {
    const onesignal = createOnesignal("secret");

    await onesignal.sendPushNotification({ userId: "user", headings: { en: "a" }, contents: { en: "a" } });
    await onesignal.sendPushNotification({ userId: "user", headings: { en: "b" }, contents: { en: "b" } });

    const [first, second] = mocks.createNotification.mock.calls.slice(-2).map(([notification]) => notification);
    expect(first?.web_push_topic).toMatch(uuid);
    expect(second?.web_push_topic).toMatch(uuid);
    expect(first?.web_push_topic).not.toBe(second?.web_push_topic);
    expect(first).not.toHaveProperty("collapse_id");
    expect(second).not.toHaveProperty("collapse_id");
  });

  it("replaces notifications sharing a topic on web and mobile", async () => {
    const onesignal = createOnesignal("secret");

    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "a" },
      contents: { en: "a" },
      topic: "t/1",
    });
    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "b" },
      contents: { en: "b" },
      topic: "t/1",
    });
    await onesignal.sendPushNotification({
      userId: "user",
      headings: { en: "c" },
      contents: { en: "c" },
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
});
