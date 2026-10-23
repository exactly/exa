/// <reference types="vite/client" />
import "./mocks/alchemy";
import "./mocks/onesignal";
import "./mocks/pax";
import "./mocks/sardine";
import "./mocks/sentry";
import "./mocks/wallet";

import { eq } from "drizzle-orm";
import { cors } from "hono/cors";
import { html } from "hono/html";
import { createCoverageMap } from "istanbul-lib-coverage";
import { createInstrumenter } from "istanbul-lib-instrument";
import crypto from "node:crypto";
import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process, { env } from "node:process";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, padHex, slice, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import lifi from "./lifi";
import database, { credentials } from "../database";
import createAlchemy from "../utils/alchemy";
import appOrigin, { origins } from "../utils/appOrigin";
import createOnesignal from "../utils/onesignal";
import createPanda from "../utils/panda";
import createSardine from "../utils/sardine";
import createSegment from "../utils/segment";
import allowWorker from "../workers/allow/worker";
import creditWorker from "../workers/credit/worker";
import hookWorker from "../workers/hook/worker";
import pokeWorker from "../workers/poke/worker";
import refundWorker from "../workers/refund/worker";
import subscribeWorker from "../workers/subscribe/worker";
import { connect } from "../workers/worker";

import type * as panda from "../utils/panda";
import type * as persona from "../utils/persona";
import type * as bridge from "../utils/ramps/bridge";
import type * as manteca from "../utils/ramps/manteca";
import type * as sentry from "@sentry/node";
import type { CoverageMapData } from "istanbul-lib-coverage";
import type { InferInput, InferOutput } from "valibot";

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      await database.delete(credentials); // eslint-disable-line drizzle/enforce-delete-with-where -- e2e starts with no users
      const { default: app, close: stop } = await import("../index");
      if (!env.REDIS_URL) throw new Error("missing redis url");
      if (!env.POSTGRES_URL) throw new Error("missing postgres url");
      const bullmq = connect(env.REDIS_URL);
      const onesignal = createOnesignal("onesignal");
      const panda = createPanda({ key: "panda", url: "https://panda.test" });
      const sardine = createSardine("sardine", "https://sardine.test");
      const segment = createSegment("segment");
      const workers = [
        allowWorker({ allower: privateKeyToAccount(padHex("0xa11")), bullmq }),
        creditWorker({ bullmq, database, onesignal }),
        pokeWorker({ bullmq, onesignal, poker: privateKeyToAccount(padHex("0xb0b")), segment }),
        refundWorker({
          bullmq,
          database,
          onesignal,
          panda,
          refunder: privateKeyToAccount(padHex("0x69")),
          sardine,
          segment,
        }),
        hookWorker({ bullmq, database, panda }),
        subscribeWorker({ alchemy: createAlchemy("webhooks"), bullmq, database }),
      ];

      await expect(
        new Promise((resolve, reject) => {
          let closing: Promise<unknown> | undefined;
          const teardown = () => {
            closing ??= Promise.allSettled([
              bullmq.quit(),
              segment.close(),
              stop(),
              ...workers.map((worker) => worker.close()),
            ]).then(resolve, reject);
          };

          const root = fileURLToPath(new URL("../..", import.meta.url));
          const baseline = Array.fromAsync(
            glob("src/**/*.{ts,tsx}", { cwd: root, exclude: ["src/generated/**", "**/*.d.ts"] }),
            async (file) => {
              const source = path.join(root, file);
              const instrumenter = createInstrumenter({
                esModules: true,
                parserPlugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
              });
              instrumenter.instrumentSync(await readFile(source, "utf8"), source); // eslint-disable-line security/detect-non-literal-fs-filename -- app source from glob
              return [file, instrumenter.lastFileCoverage()] as const;
            },
          );
          baseline.catch(reject);

          app.use("/e2e/*", cors());
          app.route("/e2e/lifi", lifi([anvil]));
          app.get("/e2e/credential", async (c) => {
            const [credential, ...rest] = await database.query.credentials.findMany({
              columns: { account: true, id: true },
              limit: 2,
            });
            return credential && rest.length === 0 ? c.json(credential) : c.json({ code: "no single credential" }, 500);
          });
          const submitted = createCoverageMap();
          app.post("/e2e/coverage", async (c) => {
            submitted.merge(await c.req.json<CoverageMapData>());
            const coverage = { ...submitted.toJSON() };
            for (const [file, empty] of await baseline) {
              if (Object.keys(coverage).some((key) => key.endsWith(`/${file}`))) continue;
              coverage[empty.path] = empty;
            }
            await mkdir("coverage", { recursive: true });
            await writeFile("coverage/app.json", JSON.stringify(coverage));
            return c.json({ code: "ok" });
          });
          app.get("/e2e/redirect", (c) =>
            c.html(html`<meta http-equiv="refresh" content="0;url=${c.req.query("url")}" />`),
          );
          app.post("/e2e/shutdown", (c) => {
            teardown();
            return c.json({ code: "ok" });
          });
          process.once("SIGTERM", teardown);

          Promise.all(workers.map((worker) => worker.ready)).catch(reject);
        }),
      ).resolves.toBeDefined();

      const related = await app.request("/.well-known/webauthn");
      expect(related.status).toBe(200);
      expect(related.headers.get("content-type")).toBe("application/json");
      await expect(related.json()).resolves.toStrictEqual({ origins: [...origins.slice(1), appOrigin] });
      for (const origin of origins) {
        const response = await app.request(`${origin}/api/auth/get-session`, { headers: { origin } });
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toBeNull();
        expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      }
    },
    Infinity,
  );
});

vi.mock("../utils/panda", async (importOriginal: () => Promise<typeof panda>) => {
  const original = await importOriginal();
  type Panda = ReturnType<typeof original.default>;
  type User = Awaited<ReturnType<Panda["getUser"]>>;
  type Card = Awaited<ReturnType<Panda["getCard"]>>;
  const users = new Map<string, User>();
  const cards = new Map<string, Card>();
  return {
    ...original,
    signIssuerOp: vi.fn().mockResolvedValue("0x" + "ab".repeat(65)),
    default: (...parameters: Parameters<typeof original.default>) => ({
      ...original.default(...parameters),
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
      getCards: vi.fn().mockResolvedValue([]),
      getPIN: vi.fn().mockResolvedValue({ pin: null }),
      getProcessorDetails: vi
        .fn()
        .mockImplementation((cardId: string) =>
          Promise.resolve({ processorCardId: `proc_${cardId}`, timeBasedSecret: `secret_${cardId}` }),
        ),
      getSecrets: vi.fn().mockImplementation((_cardId: string, sessionId: string) => {
        const privateKey = env.PANDA_E2E_PRIVATE_KEY;
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
      setPIN: vi.fn().mockResolvedValue({}),
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
    default: (...parameters: Parameters<typeof original.default>) => ({
      ...original.default(...parameters),
      getPendingInquiryTemplate: vi
        .fn()
        .mockImplementation(async (referenceId: string) =>
          (await approved(referenceId)) ? undefined : original.PANDA_TEMPLATE,
        ),
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
      getCardLimitStatus: vi.fn().mockResolvedValue({ status: "noTemplate" as const }),
      getAccount: vi
        .fn()
        .mockImplementation(async (referenceId: string) =>
          (await approved(referenceId))
            ? { id: `act_${referenceId}`, type: "account" as const, attributes: { "country-code": "AR", fields: {} } }
            : undefined,
        ),
    }),
  };
});

vi.mock("../utils/ramps/bridge", async (importOriginal: () => Promise<typeof bridge>) => {
  const original = await importOriginal();
  const accounts = new Map<string, InferOutput<typeof original.ExternalAccount>[]>();
  const beneficiaries = new Map<string, InferInput<typeof original.ExternalAccountInput>>();
  const transfers = new Map<string, { address: Address; rail?: "ach" | "wire"; reference?: string }>();
  return {
    ...original,
    default: (...parameters: Parameters<typeof original.default>) => ({
      ...original.default(...parameters),
      createExternalAccount: vi
        .fn()
        .mockImplementation(
          ({ id: customerId }: { id: string }, input: InferInput<typeof original.ExternalAccountInput>) => {
            const account = {
              addressValid: true,
              bankName: input.bankName,
              currency: input.currency,
              id: crypto.randomUUID(),
              ownerName: input.accountOwnerName,
            };
            accounts.set(customerId, [...(accounts.get(customerId) ?? []), account]);
            beneficiaries.set(account.id, input);
            return Promise.resolve(account);
          },
        ),
      createOfframpTransfer: vi
        .fn()
        .mockImplementation(
          (
            _customerId: string,
            _account: string,
            id: string,
            _currency: string,
            rail?: "ach" | "wire",
            reference?: string,
          ) => {
            transfers.set(id, {
              address: getAddress(slice(keccak256(toBytes(JSON.stringify(beneficiaries.get(id)))), 12)),
              rail,
              reference,
            });
            return Promise.resolve({ id: crypto.randomUUID() });
          },
        ),
      getCustomer: vi.fn().mockImplementation((id: string) => Promise.resolve({ id, status: "active" })),
      getDepositDetails: vi.fn().mockResolvedValue(
        (["ACH", "WIRE"] as const).map((network) => ({
          network,
          displayName: network,
          beneficiaryName: "Test User",
          routingNumber: "101019644",
          accountNumber: "900000000001",
          bankAddress: "1801 Main St, Kansas City, MO 64108",
          beneficiaryAddress: "123 Test St, New York, NY 10001",
          bankName: "Lead Bank",
          fee: "0.0",
          estimatedProcessingTime: network === "ACH" ? "1 - 3 business days" : "300",
        })),
      ),
      getOfframpDepositDetails: vi.fn().mockImplementation((id: string) => {
        const transfer = transfers.get(id);
        if (!transfer) return Promise.reject(new Error(original.ErrorCodes.OFFRAMP_TRANSFER_NOT_FOUND));
        return Promise.resolve([
          {
            network: "OPTIMISM",
            displayName: "Optimism",
            fee: "0.0",
            estimatedProcessingTime: "300",
            ...transfer,
          },
        ]);
      }),
      getProvider: vi
        .fn()
        .mockImplementation(
          ({ customerId, redirectURL }: Parameters<ReturnType<typeof original.default>["getProvider"]>[0]) => {
            const currencies = { onramp: { currencies: ["USD"] }, offramp: { currencies: ["USD"] } };
            if (customerId) return Promise.resolve({ ...currencies, status: "ACTIVE" });
            const redirect = new URL(redirectURL ?? "");
            redirect.searchParams.set("provider", "bridge");
            redirect.searchParams.set("signed_agreement_id", crypto.randomUUID());
            return Promise.resolve({
              ...currencies,
              status: "NOT_STARTED",
              tosLink: `http://localhost:3000/e2e/redirect?url=${encodeURIComponent(redirect.href)}`,
            });
          },
        ),
      listExternalAccounts: vi
        .fn()
        .mockImplementation((customerId: string) => Promise.resolve(accounts.get(customerId) ?? [])),
      onboarding: vi.fn().mockImplementation(async ({ credentialId }: { credentialId: string }) => {
        await database
          .update(credentials)
          .set({ bridgeId: crypto.randomUUID() })
          .where(eq(credentials.id, credentialId));
      }),
      removeExternalAccount: vi.fn().mockImplementation(({ id: customerId }: { id: string }, id: string) => {
        accounts.set(customerId, accounts.get(customerId)?.filter((account) => account.id !== id) ?? []);
        return Promise.resolve();
      }),
    }),
  };
});

vi.mock("../utils/ramps/manteca", async (importOriginal: () => Promise<typeof manteca>) => {
  const original = await importOriginal();
  const users = new Set<string>();
  return {
    ...original,
    default: (...parameters: Parameters<typeof original.default>) => ({
      ...original.default(...parameters),
      getProvider: vi.fn().mockImplementation((account: string) =>
        Promise.resolve(
          users.has(account)
            ? {
                onramp: {
                  currencies: original.CurrenciesByExchange.ARGENTINA,
                  limits: {
                    monthly: { available: "10000000", limit: "10000000", symbol: "ARS" },
                    yearly: { available: "120000000", limit: "120000000", symbol: "ARS" },
                  },
                },
                status: "ACTIVE",
              }
            : { onramp: { currencies: original.CurrenciesByExchange.ARGENTINA }, status: "NOT_STARTED" },
        ),
      ),
      getQuote: vi.fn().mockResolvedValue({ buyRate: "1450", sellRate: "1400" }),
      getUser: vi
        .fn()
        .mockImplementation((account: string) =>
          Promise.resolve(users.has(account) ? { exchange: "ARGENTINA", status: "ACTIVE" } : null),
        ),
      onboarding: vi.fn().mockImplementation((account: string) => {
        users.add(account);
        return Promise.resolve();
      }),
    }),
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

async function approved(referenceId: string) {
  const credential = await database.query.credentials.findFirst({
    columns: { pandaId: true },
    where: eq(credentials.id, referenceId),
  });
  return !!credential?.pandaId;
}
