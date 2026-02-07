import { vi } from "vitest";

vi.mock("../../utils/onesignal", async (importOriginal) => ({
  ...(await importOriginal()),
  sendPushNotification: vi.fn(() => Promise.resolve({})),
}));
