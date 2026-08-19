import { afterEach, vi } from "vitest";

import type createOnesignal from "../../utils/onesignal";

const onesignal = vi.hoisted(() =>
  vi.fn<(notification: Parameters<ReturnType<typeof createOnesignal>["sendPushNotification"]>[0]) => Promise<unknown>>(
    () => Promise.resolve({}),
  ),
);

export default onesignal;

vi.mock("../../utils/onesignal", async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ sendPushNotification: onesignal }),
}));

afterEach(() => {
  onesignal.mockReset().mockResolvedValue({});
});
