import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  vi.clearAllMocks();
});

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
});
