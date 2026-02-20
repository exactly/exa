/// <reference types="vite/client" />
import "./mocks/alchemy";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/onesignal";
import "./mocks/pax";
import "./mocks/redis";
import "./mocks/sardine";
import "./mocks/sentry";

import { cors } from "hono/cors";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import type * as panda from "../utils/panda";
import type * as persona from "../utils/persona";
import type * as sentry from "@sentry/node";

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      const { default: app, close } = await import("../index");

      app.use("/e2e/*", cors());
      app.post("/e2e/coverage", async (c) => {
        await mkdir("coverage", { recursive: true });
        await writeFile("coverage/app.json", JSON.stringify(await c.req.json()));
        return c.json({ code: "ok" });
      });

      await expect(
        new Promise((resolve) => {
          const teardown = () => void close().finally(() => resolve(null)); // eslint-disable-line no-void
          app.post("/e2e/shutdown", (c) => {
            teardown();
            return c.json({ code: "ok" });
          });
          process.once("SIGTERM", teardown);
        }),
      ).resolves.toBeNull();
    },
    Infinity,
  );
});

vi.mock("../utils/panda", async (importOriginal: () => Promise<typeof panda>) => {
  const original = await importOriginal();
  type User = Awaited<ReturnType<typeof original.getUser>>;
  type Card = Awaited<ReturnType<typeof original.getCard>>;
  const users = new Map<string, User>();
  const cards = new Map<string, Card>();
  return {
    ...original,
    autoCredit: vi.fn().mockResolvedValue(false),
    createCard: vi.fn().mockImplementation((userId: string) => {
      const id = crypto.randomUUID();
      const card: Card = {
        expirationMonth: "12",
        expirationYear: "2030",
        id,
        last4: String(Math.floor(1000 + Math.random() * 9000)),
        limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
        status: "active",
        type: "virtual",
        userId,
      };
      cards.set(id, card);
      return Promise.resolve(card);
    }),
    createUser: vi.fn().mockImplementation(() => {
      const id = `usr_${Math.random().toString(36).slice(2)}`;
      const user: User = {
        applicationReason: "",
        applicationStatus: "approved",
        email: "test@example.com",
        firstName: "Test",
        id,
        isActive: true,
        lastName: "User",
        phoneCountryCode: "+1",
        phoneNumber: "5551234567",
      };
      users.set(id, user);
      return Promise.resolve({ id });
    }),
    getCard: vi.fn().mockImplementation((cardId: string) => Promise.resolve(cards.get(cardId))),
    getPIN: vi.fn().mockResolvedValue({ pin: null }),
    getSecrets: vi.fn().mockImplementation((_cardId: string, sessionId: string) => {
      const privateKey = process.env.PANDA_E2E_PRIVATE_KEY;
      if (!privateKey) throw new Error("PANDA_E2E_PRIVATE_KEY not set");
      const encryptedSecret = Buffer.from(sessionId, "base64");
      const secretKeyBase64 = crypto.privateDecrypt(
        { key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha1" },
        encryptedSecret,
      );
      const secretKey = Buffer.from(secretKeyBase64.toString("utf8"), "base64");
      function encrypt(plaintext: string) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv("aes-128-gcm", secretKey, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return { data: Buffer.concat([encrypted, authTag]).toString("base64"), iv: iv.toString("base64") };
      }
      return Promise.resolve({
        encryptedCvc: encrypt("123"),
        encryptedPan: encrypt("4111111111111234"),
      });
    }),
    getUser: vi.fn().mockImplementation((userId: string) => Promise.resolve(users.get(userId))),
    getApplicationStatus: vi.fn().mockResolvedValue({ id: "pandaId", applicationStatus: "approved" }),
    isPanda: vi.fn().mockResolvedValue(true),
    setPIN: vi.fn().mockResolvedValue({}),
    signIssuerOp: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
    updateCard: vi.fn().mockImplementation((update: { id: string }) => {
      const card = cards.get(update.id);
      if (!card) return Promise.resolve();
      Object.assign(card, update);
      return Promise.resolve(card);
    }),
    updateUser: vi.fn().mockImplementation((update: { id: string }) => {
      const user = users.get(update.id);
      if (!user) return Promise.resolve();
      Object.assign(user, update);
      return Promise.resolve(user);
    }),
  };
});

vi.mock("../utils/persona", async (importOriginal: () => Promise<typeof persona>) => {
  const original = await importOriginal();
  const inquiries = new Map<
    string,
    { id: string; referenceId: string; status: "approved" | "created" | "expired" | "pending"; templateId: string }
  >();
  return {
    ...original,
    getPendingInquiryTemplate: vi.fn().mockResolvedValue(original.PANDA_TEMPLATE),
    getInquiry: vi.fn().mockImplementation((referenceId: string, templateId: string) => {
      const key = `${referenceId}:${templateId}`;
      const inquiry = inquiries.get(key);
      if (!inquiry) return Promise.resolve();
      return Promise.resolve({
        id: inquiry.id,
        type: "inquiry" as const,
        attributes: { status: inquiry.status, "reference-id": inquiry.referenceId },
      });
    }),
    createInquiry: vi.fn().mockImplementation((referenceId: string, templateId: string) => {
      const id = `inq_${Math.random().toString(36).slice(2)}`;
      inquiries.set(`${referenceId}:${templateId}`, { id, status: "created", referenceId, templateId });
      return Promise.resolve({
        data: {
          id,
          type: "inquiry" as const,
          attributes: { status: "created" as const, "reference-id": referenceId },
        },
      });
    }),
    resumeInquiry: vi.fn().mockImplementation((inquiryId: string) => {
      for (const inquiry of inquiries.values()) {
        if (inquiry.id === inquiryId && inquiry.status === "created") {
          inquiry.status = "pending";
        }
      }
      return Promise.resolve({
        data: { id: inquiryId, type: "inquiry" as const },
        meta: { "session-token": "mock-session-token" },
      });
    }),

    getDocument: vi.fn().mockResolvedValue({
      id: "doc_mock",
      attributes: { "back-photo": null, "front-photo": null, "selfie-photo": null, "id-class": "dl" },
    }),
    addDocument: vi.fn().mockResolvedValue({ data: { id: "acc_mock" } }),
    getAccounts: vi.fn().mockResolvedValue({ data: [] }),
    getAccount: vi.fn().mockResolvedValue(null),
  };
});

vi.mock("../utils/allower", () => ({
  default: vi.fn(() => Promise.resolve({ allow: vi.fn().mockResolvedValue({}) })),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const { captureException, ...original } = await importOriginal<typeof sentry>();
  return {
    ...original,
    captureException(...args: Parameters<typeof sentry.captureException>) {
      console.log(...args); // eslint-disable-line no-console
      return captureException(...args);
    },
  };
});
