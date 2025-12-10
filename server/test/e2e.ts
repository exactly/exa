/// <reference types="vite/client" />
import "./mocks/sentry";
import "./mocks/database";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/redis";

import { createCipheriv } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { autoCredit, createCard, getCard, getPIN, getSecrets, getUser, setPIN } from "../utils/panda";

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      const { default: app, close } = await import("../index");

      app.post("/e2e/coverage", async (c) => {
        mkdirSync("coverage", { recursive: true });
        writeFileSync("coverage/app.json", JSON.stringify(await c.req.json()));
        return c.json({ code: "ok" });
      });

      await expect(
        new Promise((resolve) => {
          app.post("/e2e/shutdown", (c) => {
            close()
              .then(resolve)
              .catch(() => resolve(null));
            return c.json({ code: "ok" });
          });

          process.once("SIGTERM", () => {
            close()
              .then(resolve)
              .catch(() => resolve(null));
          });
        }),
      ).resolves.toBeNull();
    },
    Infinity,
  );
});

vi.mock("../utils/alchemy", async (importOriginal) => ({
  ...(await importOriginal()),
  findWebhook: vi.fn<() => Promise<void>>().mockResolvedValue(),
  createWebhook: vi
    .fn<() => Promise<{ id: string; signing_key: string }>>()
    .mockResolvedValue({ id: "123", signing_key: "123" }),
}));

vi.mock("../utils/panda", async (importOriginal) => ({
  ...(await importOriginal()),
  getCard: vi.fn<() => ReturnType<typeof getCard>>().mockResolvedValue({
    id: "666",
    last4: "0420",
    status: "active",
    userId: "69",
    type: "virtual",
    limit: { amount: 10_000, frequency: "per7DayPeriod" },
    expirationMonth: "12",
    expirationYear: "2025",
  }),
  createCard: vi.fn<() => ReturnType<typeof createCard>>().mockResolvedValue({
    id: "666",
    last4: "0420",
    status: "active",
    userId: "69",
    type: "virtual",
    limit: { amount: 10_000, frequency: "per7DayPeriod" },
    expirationMonth: "12",
    expirationYear: "2025",
  }),
  createUser: vi.fn<() => Promise<{ id: string }>>().mockResolvedValue({ id: "69" }),
  getSecrets: vi.fn<() => Promise<ReturnType<typeof getSecrets>>>().mockResolvedValue({
    encryptedPan: encrypt("4200006942000069"),
    encryptedCvc: encrypt("420"),
  }),
  getPIN: vi.fn<() => ReturnType<typeof getPIN>>().mockResolvedValue({ pin: null }),
  setPIN: vi.fn<() => ReturnType<typeof setPIN>>().mockResolvedValue({}),
  getUser: vi.fn<() => ReturnType<typeof getUser>>().mockResolvedValue({
    id: "69",
    firstName: "TEST",
    lastName: "USER",
    email: "test@example.com",
    isActive: true,
    phoneCountryCode: "1",
    phoneNumber: "5551234567",
    applicationStatus: "approved",
    applicationReason: "ok",
  }),
  autoCredit: vi.fn<() => ReturnType<typeof autoCredit>>().mockResolvedValue(false),
}));

vi.mock("../utils/persona", async (importOriginal) => ({
  ...(await importOriginal()),
  getInquiry: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));

function encrypt(plaintext: string) {
  const key = Buffer.from("000102030405060708090a0b0c0d0e0f", "hex");
  const iv = Buffer.alloc(16, 0);
  const cipher = createCipheriv("aes-128-gcm", key, iv);
  const cipherText = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("base64"), data: Buffer.concat([cipherText, tag]).toString("base64") };
}
