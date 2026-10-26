/// <reference types="vite/client" />
import "./mocks/alchemy";
import "./mocks/onesignal";
import "./mocks/pax";
import "./mocks/sardine";
import "./mocks/sentry";
import "./mocks/wallet";

import { serve } from "@hono/node-server";
import {
  ExtendedKeyUsage,
  ExtendedKeyUsageExtension,
  SubjectAlternativeNameExtension,
  X509CertificateGenerator,
} from "@peculiar/x509";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { html } from "hono/html";
import { createCoverageMap } from "istanbul-lib-coverage";
import { createInstrumenter } from "istanbul-lib-instrument";
import { createContext } from "istanbul-lib-report";
import { create } from "istanbul-reports";
import crypto from "node:crypto";
import { glob, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:https";
import { homedir } from "node:os";
import path from "node:path";
import process, { env } from "node:process";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { getAddress, keccak256, padHex, slice, toBytes, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

import domain from "@exactly/common/domain";
import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";

import { chains } from "./anvil";
import lifi from "./lifi";
import database, { cards as cardsTable, credentials } from "../database";
import createAlchemy from "../utils/alchemy";
import appOrigin, { origins } from "../utils/appOrigin";
import createOnesignal from "../utils/onesignal";
import createPanda from "../utils/panda";
import {
  BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE,
  BUSINESS_TEMPLATE,
  PANDA_BUSINESS_CHECKBOX_TEMPLATE,
} from "../utils/persona";
import createSardine from "../utils/sardine";
import createSegment from "../utils/segment";
import ServiceError from "../utils/ServiceError";
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
      const tls = await certificate();
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
      async function deliver(inquiry: Inquiry, status: Inquiry["status"]) {
        inquiry.status = status;
        const body = JSON.stringify({
          data: {
            type: "event",
            id: `evt_${crypto.randomUUID()}`,
            attributes: {
              name: `inquiry.${status}`,
              payload: {
                data: {
                  type: "inquiry",
                  id: inquiry.id,
                  attributes: {
                    status,
                    referenceId: inquiry.referenceId,
                    fields: Object.fromEntries(
                      Object.entries(inquiry.fields).map(([key, value]) => [
                        key,
                        { value: /^\d+$/.test(value) ? Number(value) : value },
                      ]),
                    ),
                  },
                  relationships: { inquiryTemplate: { data: { id: inquiry.templateId } } },
                },
              },
            },
          },
        });
        const t = Date.now();
        const hook = await app.request("/hooks/persona", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "persona-signature": `t=${t},v1=${crypto.createHmac("sha256", "persona").update(`${t}.${body}`).digest("hex")}`,
          },
          body,
        });
        const result = await hook.text();
        if (result !== JSON.stringify({ code: "ok" })) throw new Error(result);
      }
      const hostedFlow = new Hono()
        .get("/widget", (c) => {
          const inquiry = [...inquiries.values()].find(({ id }) => id === c.req.query("inquiry-id"));
          return inquiry ? c.html(widget(inquiry.templateId)) : c.text("no inquiry", 404);
        })
        .post("/widget", async (c) => {
          const inquiry = [...inquiries.values()].find(({ id }) => id === c.req.query("inquiry-id"));
          if (inquiry?.status !== "pending") return c.text("no pending inquiry", 404);
          inquiry.fields = await c.req.json<Record<string, string>>();
          await deliver(inquiry, "completed");
          if (inquiry.templateId !== BUSINESS_TEMPLATE || !inquiry.fields.primary_contact_email?.endsWith("e2e.exa")) {
            await deliver(inquiry, "approved");
          }
          return c.json({ status: inquiry.status });
        });
      const kyb = new Hono()
        .get("/widget", (c) =>
          customers.get(c.req.query("reference-id") ?? "")?.status === "not_started"
            ? c.html(widget(BRIDGE_KYB_TEMPLATE))
            : c.text("no customer to verify", 404),
        )
        .post("/widget", (c) => {
          const customer = customers.get(c.req.query("reference-id") ?? "");
          if (customer?.status !== "not_started") return c.text("no customer to verify", 404);
          customer.status = "under_review";
          return c.json({ status: "completed" });
        });
      const hosts: Record<string, Hono> = {
        "bridge.withpersona.com": kyb,
        "inquiry.withpersona.com": hostedFlow,
      };
      const https = serve({
        fetch: (request, bindings) => {
          const address = bindings.incoming.socket.remoteAddress;
          if (address) request.headers.set("do-connecting-ip", address);
          return (hosts[new URL(request.url).hostname] ?? app).fetch(request, bindings);
        },
        port: domain === "localhost" ? 8443 : 443,
        createServer,
        serverOptions: tls,
      });

      await expect(
        new Promise((resolve, reject) => {
          let closing: Promise<unknown> | undefined;
          const teardown = () => {
            closing ??= Promise.allSettled([
              Promise.allSettled(workers.map((worker) => worker.close())).then(() => bullmq.quit()),
              segment.close(),
              stop(),
              new Promise((closed) => https.close(closed)),
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
          app.route("/e2e/lifi", lifi(chains));
          app.get("/e2e/credential", async (c) => {
            const credential = await database.query.credentials.findFirst({
              columns: { id: true },
              where: eq(credentials.account, c.req.query("account") ?? ""),
            });
            return credential ? c.json(credential) : c.json({ code: "no credential" }, 404);
          });
          app.get("/e2e/card", async (c) => {
            const [card, ...rest] = await database
              .select({ id: cardsTable.id, mode: cardsTable.mode })
              .from(cardsTable)
              .where(
                and(eq(cardsTable.credentialId, c.req.query("credential") ?? ""), eq(cardsTable.status, "ACTIVE")),
              );
            return card && rest.length === 0 ? c.json(card) : c.json({ code: "no single card" }, 404);
          });
          app.get("/e2e/download", async (c) => {
            const since = Number(c.req.query("since"));
            const downloads = path.join(homedir(), "Downloads");
            for (let attempt = 0; attempt < 40; attempt++) {
              for await (const name of glob("account-statement-*.pdf", { cwd: downloads })) {
                const file = path.join(downloads, name);
                const { mtimeMs } = await stat(file); // eslint-disable-line security/detect-non-literal-fs-filename -- browser download
                if (mtimeMs < since) continue;
                const bytes = await readFile(file); // eslint-disable-line security/detect-non-literal-fs-filename -- browser download
                if (String(bytes.subarray(0, 5)) === "%PDF-") return c.json({ code: "ok" });
              }
              await setTimeout(200);
            }
            return c.json({ code: "no download" }, 404);
          });
          app.post("/e2e/platinum", async (c) => {
            const [card, ...rest] = await database
              .update(cardsTable)
              .set({ productId: PLATINUM_PRODUCT_ID })
              .where(and(eq(cardsTable.credentialId, await c.req.text()), eq(cardsTable.status, "ACTIVE")))
              .returning({ id: cardsTable.id });
            return card && rest.length === 0 ? c.json({ code: "ok" }) : c.json({ code: "no single card" }, 500);
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
            create("lcovonly", { file: "app.lcov", projectRoot: root }).execute(
              createContext({ coverageMap: createCoverageMap(coverage) }),
            );
            return c.json({ code: "ok" });
          });
          app.post("/e2e/review", async (c) => {
            switch (await c.req.text()) {
              case "persona": {
                const inquiry = [...inquiries.values()].find(({ status }) => status === "completed");
                if (!inquiry) break;
                await deliver(inquiry, "approved");
                return c.json({ code: "ok" });
              }
              case "bridge": {
                const customer = [...customers.values()].find(({ status }) => status === "under_review");
                if (!customer) break;
                customer.status = "active";
                return c.json({ code: "ok" });
              }
            }
            return c.json({ code: "nothing to review" }, 404);
          });
          app.get("/e2e/redirect", (c) =>
            c.html(html`<meta http-equiv="refresh" content="0;url=${c.req.query("url")}" />`),
          );
          app.post("/e2e/shutdown", (c) => {
            teardown();
            return c.json({ code: "ok" });
          });
          process.once("SIGTERM", teardown);

          https.once("error", reject);
          Promise.all(workers.map((worker) => worker.ready)).catch(reject);
        }),
      ).resolves.toBeDefined();

      const related = await app.request("/.well-known/webauthn");
      expect(related.status).toBe(200);
      expect(related.headers.get("content-type")).toBe("application/json");
      await expect(related.json()).resolves.toStrictEqual({ origins: [...origins.slice(1), appOrigin] });
      const missing = await app.request("/missing");
      const page = await app.request("/+not-found.html");
      expect(missing.status).toBe(404);
      expect(missing.headers.get("content-type")).toBe(page.headers.get("content-type"));
      await expect(missing.text()).resolves.toBe(await page.text());
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

async function certificate() {
  const algorithm = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" };
  const keys = await crypto.subtle.generateKey(algorithm, true, ["sign", "verify"]);
  const leaf = await X509CertificateGenerator.createSelfSigned({
    name: `CN=${domain}`,
    keys,
    signingAlgorithm: algorithm,
    extensions: [
      new ExtendedKeyUsageExtension([ExtendedKeyUsage.serverAuth]),
      new SubjectAlternativeNameExtension([{ type: "dns", value: domain }]),
    ],
  });
  return {
    cert: leaf.toString("pem"),
    key: crypto.KeyObject.from(keys.privateKey).export({ format: "pem", type: "pkcs8" }),
  };
}

type Inquiry = {
  fields: Record<string, string>;
  id: string;
  referenceId: string;
  status: InferOutput<typeof persona.Inquiry>["attributes"]["status"];
  templateId: string;
};

const inquiries = vi.hoisted(() => new Map<string, Inquiry>());

type Company = Awaited<ReturnType<ReturnType<typeof panda.default>["createCompanyApplication"]>>;

const companies = vi.hoisted(() => new Map<string, Company>());

type Customer = { status: "active" | "not_started" | "under_review" };

const customers = vi.hoisted(() => new Map<string, Customer>());

const BRIDGE_KYB_TEMPLATE = "itmpl_bridge_kyb";

vi.mock("../utils/panda", async (importOriginal: () => Promise<typeof panda>) => {
  const original = await importOriginal();
  type Panda = ReturnType<typeof original.default>;
  type User = Awaited<ReturnType<Panda["getUser"]>>;
  type Card = Awaited<ReturnType<Panda["getCard"]>>;
  const users = new Map<string, User>();
  const cards = new Map<string, Card>();
  const members = new Map<string, Awaited<ReturnType<Panda["getCompanyUsers"]>>>();
  return {
    ...original,
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
      createCompanyApplication: vi
        .fn()
        .mockImplementation(
          (
            externalId: string,
            {
              address,
              initialUser,
              name,
              representatives,
              ultimateBeneficialOwners,
            }: Parameters<Panda["createCompanyApplication"]>[1],
          ) => {
            if (
              [initialUser, ...representatives, ...ultimateBeneficialOwners].some(
                ({ countryOfIssue, nationalId }) => countryOfIssue === "US" && !/^\d{9}$/.test(nationalId),
              )
            ) {
              return Promise.reject(
                new ServiceError(
                  "Panda",
                  400,
                  JSON.stringify({
                    statusCode: 400,
                    error: "Bad Request",
                    message: "National id should be 9-digit SSN if country of issue is US",
                  }),
                ),
              );
            }
            const id = crypto.randomUUID();
            const user: User = {
              applicationReason: "",
              applicationStatus: "approved",
              email: initialUser.email,
              firstName: initialUser.firstName,
              id: crypto.randomUUID(),
              isActive: true,
              lastName: initialUser.lastName,
              phoneCountryCode: "+1",
              phoneNumber: "5551234567",
            };
            users.set(user.id, user);
            members.set(id, [{ companyId: id, id: user.id, walletAddress: initialUser.walletAddress }]);
            const company: Company = {
              address,
              applicationStatus:
                original.kycStatus.find((status) =>
                  name.replaceAll(" ", "").toLowerCase().includes(status.toLowerCase()),
                ) ?? "needsVerification",
              externalId,
              id,
              name,
            };
            companies.set(externalId, company);
            return Promise.resolve(company);
          },
        ),
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
      getCompanyApplication: vi
        .fn()
        .mockImplementation((externalId: string) => Promise.resolve(companies.get(externalId))),
      getCompanyUsers: vi.fn().mockImplementation((companyId: string) => Promise.resolve(members.get(companyId) ?? [])),
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
  return {
    ...original,
    default: (...parameters: Parameters<typeof original.default>) => ({
      ...original.default(...parameters),
      getPendingInquiryTemplate: vi.fn().mockImplementation(async (referenceId: string, scope: string) => {
        if (scope !== "business") return (await approved(referenceId)) ? undefined : original.PANDA_TEMPLATE;
        return inquiries.get(`${referenceId}:${original.BUSINESS_TEMPLATE}`)?.status === "approved"
          ? undefined
          : original.BUSINESS_TEMPLATE;
      }),
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
        inquiries.set(`${referenceId}:${templateId}`, { fields: {}, id, status: "created", referenceId, templateId });
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
      getAccount: vi.fn().mockImplementation(async (referenceId: string, scope: string) => {
        if (scope !== "business") {
          return (await approved(referenceId))
            ? { id: `act_${referenceId}`, type: "account" as const, attributes: { "country-code": "AR", fields: {} } }
            : undefined;
        }
        const inquiry = inquiries.get(`${referenceId}:${original.BUSINESS_TEMPLATE}`);
        if (inquiry?.status !== "approved") return;
        const { day, month, year, ...fields } = inquiry.fields;
        return {
          id: `act_${referenceId}`,
          type: "account" as const,
          attributes: {
            "reference-id": referenceId,
            fields: { ...fields, ubo_birth_date: `${year}-${month}-${day?.padStart(2, "0")}` },
          },
        };
      }),
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
      getDepositDetails: vi.fn().mockImplementation((currency: (typeof original.FiatCurrency)[number]) => {
        const details = { beneficiaryName: "Test User", fee: "0.0", estimatedProcessingTime: "300" };
        switch (currency) {
          case "USD":
            return Promise.resolve(
              (["ACH", "WIRE"] as const).map((network) => ({
                ...details,
                network,
                displayName: network,
                routingNumber: "101019644",
                accountNumber: "900000000001",
                bankAddress: "1801 Main St, Kansas City, MO 64108",
                beneficiaryAddress: "123 Test St, New York, NY 10001",
                bankName: "Lead Bank",
                estimatedProcessingTime: network === "ACH" ? "1 - 3 business days" : "300",
              })),
            );
          case "EUR":
            return Promise.resolve([
              { ...details, network: "SEPA", displayName: "SEPA", iban: "DE89370400440532013000" },
            ]);
          case "MXN":
            return Promise.resolve([{ ...details, network: "SPEI", displayName: "SPEI", clabe: "032180000118359719" }]);
          case "BRL":
            return Promise.resolve([
              {
                ...details,
                network: "PIX-BR",
                displayName: "PIX BR",
                brCode:
                  "00020126580014br.gov.bcb.pix01362c3b5f0e-6f7a-4d8b-9c1e-0a2b3c4d5e6f5204000053039865802BR5909Test User6009SAO PAULO61080131010062070503***6304B61A",
              },
            ]);
          case "GBP":
            return Promise.resolve([
              {
                ...details,
                network: "FASTER_PAYMENTS",
                displayName: "Faster Payments",
                accountHolderName: "Test User",
                accountNumber: "12345678",
                sortCode: "040004",
                bankName: "Test Bank",
                bankAddress: "1 Test St, London, EC1A 1BB",
              },
            ]);
        }
      }),
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
          ({
            accountType,
            customerId,
            redirectURL,
          }: Parameters<ReturnType<typeof original.default>["getProvider"]>[0]) => {
            const fiat = accountType === "business" ? ["USD", "EUR"] : ["USD", "EUR", "MXN", "BRL", "GBP"];
            const currencies = { onramp: { currencies: fiat }, offramp: { currencies: fiat } };
            switch (customerId && customers.get(customerId)?.status) {
              case "not_started":
                return Promise.resolve({
                  ...currencies,
                  status: "ONBOARDING",
                  kycLink: `https://bridge.withpersona.com/verify?${String(
                    new URLSearchParams({
                      "inquiry-template-id": BRIDGE_KYB_TEMPLATE,
                      "environment-id": "env_bridge",
                      "reference-id": customerId ?? "",
                    }),
                  )}`,
                });
              case "under_review":
                return Promise.resolve({ ...currencies, status: "ONBOARDING" });
            }
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
      getQuote: vi.fn().mockImplementation((_: "USD", to: (typeof original.QuoteCurrency)[number]) => {
        const rate = { BRL: "5.4", EUR: "0.9", GBP: "0.8", MXN: "18", USD: "1.0", USDC: "1.0", USDT: "1.0" }[to];
        return Promise.resolve({ buyRate: rate, sellRate: rate });
      }),
      listExternalAccounts: vi
        .fn()
        .mockImplementation((customerId: string) => Promise.resolve(accounts.get(customerId) ?? [])),
      onboarding: vi
        .fn()
        .mockImplementation(
          async ({ accountType, credentialId }: Parameters<ReturnType<typeof original.default>["onboarding"]>[0]) => {
            const id = crypto.randomUUID();
            if (accountType === "business") customers.set(id, { status: "not_started" });
            await database.update(credentials).set({ bridgeId: id }).where(eq(credentials.id, credentialId));
          },
        ),
      removeExternalAccount: vi.fn().mockImplementation(({ id: customerId }: { id: string }, id: string) => {
        accounts.set(customerId, accounts.get(customerId)?.filter((account) => account.id !== id) ?? []);
        return Promise.resolve();
      }),
      updateExternalAccount: vi.fn().mockImplementation(({ id: customerId }: { id: string }, id: string) => {
        const account = accounts.get(customerId)?.find((external) => external.id === id);
        if (!account) return Promise.reject(new Error(original.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND));
        return Promise.resolve(account);
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
      getQuote: vi
        .fn()
        .mockImplementation((coinPair: string) =>
          Promise.resolve(
            coinPair === "USDC_USD" ? { buyRate: "1.08", sellRate: "1.0" } : { buyRate: "1450", sellRate: "1400" },
          ),
        ),
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

function widget(templateId: string) {
  const link = (text: string, href: string) => html`<a href="${href}">${text}</a>`;
  const ubo = html`<h2>We need information about the company's UBOs (Ultimate beneficial owners)</h2>
    <p>UBOs are individuals that own 25% or more of the company</p>`;
  const country = [
    ["Select a country", ""],
    ["Brazil", "BR"],
    ["United States", "US"],
  ] satisfies [string, string][];
  const screens: Record<string, ReturnType<typeof html>[]> = {
    [BUSINESS_TEMPLATE]: [
      html`<h1>Getting started</h1>
        <p>We need some information to start the verification process.</p>
        ${field("Company name", "business_name")}
        <h2>Business Industry</h2>
        ${select("Industry Category", "company_industry", [
          ["Select an industry category...", ""],
          ["54 - Professional, Scientific, and Technical Services", "54"],
        ])}
        ${select("NAICS Code", "company_industry_naics", [
          ["Select a NAICS code...", ""],
          ["541511 - Custom Computer Programming Services", "541511"],
        ])}
        ${select("Country of incorporation", "company_country", country)}
        ${field("Company Registration Number", "company_registration_number")}
        ${field("Company tax ID", "company_tax_id")}
        <button>Continue</button>`,
      html`${address("Company address", 2, "street_2")} ${field("Company description", "company_description")}
        ${field("URL", "company_website", "https://...")} ${field("Primary contact email", "primary_contact_email")}
        <button>Continue</button>`,
      html`${ubo} ${field("UBO's name", "ubo_name_1")} ${field("UBO's last name", "ubo_last_name_1")}
        <p>Birth Date</p>
        ${select("Month", "month", [
          ["Month", ""],
          ...[
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ].map((month, index) => [month, String(index + 1).padStart(2, "0")] satisfies [string, string]),
        ])}
        ${field("Day", "day", "Day")} ${field("Year", "year", "Year")}
        ${select("Country that issued the UBO's ID", "ubo_country_id_1", country)} ${field("ID Number", "ubo_id_1")}
        ${select("Country of residence of the UBO", "ubo_country_residency_1", country)}
        <button>Continue</button>`,
      html`${ubo} ${address("UBO's address", 3, "street_2_2")} ${field("UBO's email", "ubo_email_1")}
        <label for="ubo_phone_1">UBO's phone number</label>
        <select aria-label="Phone number country">
          <option>International</option>
        </select>
        <input id="ubo_phone_1" name="ubo_phone_1" type="tel" />
        <button>Done</button>
        <button type="button">I need to add another UBO</button>`,
    ],
    [PANDA_BUSINESS_CHECKBOX_TEMPLATE]: [
      html`<h1>Terms and conditions</h1>
        ${check("consent", [
          "I accept the ",
          link(
            "E-Sign Consent",
            "https://help.exactly.app/en/articles/10430854-e-sign-electronic-communications-notice",
          ),
        ])}
        ${check("terms", [
          "I accept the",
          link(
            " Exa Card Terms",
            "https://help.exactly.app/en/articles/11840074-exa-business-card-terms-and-conditons",
          ),
          ", and the ",
          link("Issuer Privacy Policy", "https://legal.raincards.xyz/legal/privacy-policy"),
        ])}
        ${check(
          "accuracy",
          "I certify that the information I have provided is accurate and that I will abide by all the rules and requirements related to my Exa Spend Card.",
        )}
        ${check(
          "solicitation",
          "I acknowledge that applying for the Exa Spend Card does not constitute unauthorized solicitation.",
        )}
        <button>Done</button>`,
    ],
    [BRIDGE_KYB_TEMPLATE]: [
      html`<h1>Verify your business</h1>
        <p>We need some information about your business to enable USD and EUR accounts.</p>
        ${select("Business type", "business_type", [
          ["Select a business type...", ""],
          ["Cooperative", "cooperative"],
          ["Corporation", "corporation"],
          ["LLC", "llc"],
          ["Partnership", "partnership"],
          ["Sole proprietorship", "sole_prop"],
          ["Trust", "trust"],
        ])}
        ${field("Tax identification number", "tax_identification_number")}
        <button>Submit</button>`,
    ],
    [BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE]: [
      html`<h1>Just the basics</h1>
        <p>We just need some information about the card holder to issue the Card</p>
        <button>Complete the form</button>`,
      html`<h1>Just the basics</h1>
        <p>Nothing fancy, just some information about the cardholder</p>
        ${field("First name", "authUserName")} ${field("Last name", "authUserLastName")} ${field("Email address", "authUserEmail")}
        ${field("Weekly spending limit", "weeklyCardLimit")}
        ${check("agreement", [
          "I accept the ",
          link(
            "Authorized User Agreement",
            "https://help.exactly.app/en/articles/11840175-exa-business-card-authorized-user-terms",
          ),
        ])}
        <button>Continue</button>`,
    ],
  };
  return html`<!doctype html>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width" />
    <style>
      body {
        font: 16px system-ui;
        margin: 0;
        padding: 24px;
      }
      input,
      select,
      button {
        display: block;
        box-sizing: border-box;
        width: 100%;
        height: 48px;
        margin: 8px 0 16px;
      }
      [hidden] {
        display: none;
      }
      .check {
        display: flex;
        gap: 8px;
        margin: 16px 0;
      }
      .check input {
        flex: none;
        width: 20px;
        height: 20px;
        margin: 0;
      }
      [role="alert"] {
        position: fixed;
        inset: 0 0 auto;
        padding: 16px 48px;
        background: #fee;
      }
      [role="alert"] button {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 24px;
        height: 24px;
      }
    </style>
    <div role="alert">
      <p>You are in a Sandbox environment.</p>
      <button aria-label="Close" onclick="this.parentElement.remove()">×</button>
    </div>
    ${(screens[templateId] ?? []).map((screen, index) => html`<form ${index ? "hidden" : ""}>${screen}</form>`)}
    <section hidden>
      <h1>Congratulations, you’re done!</h1>
      <p>Thanks for verifying your identity.</p>
      <button>Done</button>
    </section>
    <script>
      function manual(button) {
        button.hidden = true;
        button.nextElementSibling.hidden = false;
      }
      const query = new URLSearchParams(location.search);
      const message = (name, metadata = {}) =>
        parent.postMessage(
          { containerId: query.get("container-id"), templateId: query.get("inquiry-template-id"), name, metadata },
          query.get("iframe-origin"),
        );
      const forms = [...document.forms];
      const fields = {};
      for (const [index, form] of forms.entries()) {
        form.addEventListener("submit", async (event) => {
          event.preventDefault();
          Object.assign(fields, Object.fromEntries(new FormData(form)));
          form.hidden = true;
          const next = forms[index + 1];
          if (next) {
            next.hidden = false;
            message("page-change", { name: "screen_" + (index + 1) });
            return;
          }
          const response = await fetch(location.href, { method: "POST", body: JSON.stringify(fields) });
          const { status } = await response.json();
          const success = document.querySelector("section");
          success.hidden = false;
          message("page-change", { name: "success" });
          success
            .querySelector("button")
            .addEventListener("click", () =>
              message("complete", { inquiryId: query.get("inquiry-id"), referenceId: null, status, fields: null }),
            );
        });
      }
      message("load");
      message("start", { inquiryId: query.get("inquiry-id") });
      message("ready", { preferredDimensions: {}, styles: {} });
    </script>`;

  function field(label: string, name: string, placeholder = "") {
    return html`<label for="${name}">${label}</label
      ><input id="${name}" name="${name}" placeholder="${placeholder}" />`;
  }

  function select(label: string, name: string, options: [string, string][]) {
    return html`<label for="${name}">${label}</label>
      <select id="${name}" name="${name}">
        ${options.map(([text, value]) => html`<option value="${value}">${text}</option>`)}
      </select>`;
  }

  function address(label: string, index: number, line2: string) {
    return html`<label for="street_1_${index}">${label}</label>
      <input id="street_1_${index}" name="street_1_${index}" placeholder="Street address" />
      <button type="button" onclick="manual(this)">+ or edit address manually</button>
      <div hidden>
        <input name="${line2}" placeholder="Apt / Suite" />
        <input name="city_${index}" placeholder="City" />
        <input name="subdivision_${index}" placeholder="Province" />
        <input name="postal_code_${index}" placeholder="Postal code" />
        <input name="country_code_${index}" type="hidden" value="BR" />
      </div>`;
  }

  function check(id: string, label: (ReturnType<typeof html> | string)[] | string) {
    return html`<div class="check">
      <input type="checkbox" id="${id}" required /><label for="${id}">${label}</label>
    </div>`;
  }
}

async function approved(referenceId: string) {
  const credential = await database.query.credentials.findFirst({
    columns: { pandaId: true },
    where: eq(credentials.id, referenceId),
  });
  return !!credential?.pandaId;
}
