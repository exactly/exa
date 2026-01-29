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
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

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

vi.mock("../utils/panda", async (importOriginal) => ({
  ...(await importOriginal()),
  createUser: vi
    .fn<() => Promise<{ id: string }>>()
    .mockImplementation(() => Promise.resolve({ id: String(Math.random()) })),
}));

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
