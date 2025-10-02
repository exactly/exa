import "../mocks/sentry";
import "../mocks/auth";
import "../mocks/database";
import "../mocks/deployments";

import deriveAddress from "@exactly/common/deriveAddress";
import chain from "@exactly/common/generated/chain";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import crypto from "node:crypto";
import type * as v from "valibot";
import { zeroHash, padHex, zeroAddress, getAddress, sha256 } from "viem";
import { mnemonicToAccount, privateKeyToAddress } from "viem/accounts";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/kyc";
import database, { credentials, sources } from "../../database";
import auth from "../../utils/auth";
import * as kyc from "../../utils/kyc";
import * as panda from "../../utils/panda";
import * as persona from "../../utils/persona";

const appClient = testClient(app);

describe("authenticated", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(),
        account,
        factory: zeroAddress,
        pandaId: "pandaId",
      },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok kyc approved with country code", async () => {
    await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
    const getInquiry = vi.spyOn(persona, "getInquiry");
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...personaTemplate,
      type: "account",
      attributes: {
        "country-code": "AR",
        "social-security-number": null,
        "address-street-1": "123 Main St",
        "address-street-2": null,
        "address-city": "New York",
        "address-subdivision": null,
        "address-postal-code": "10001",
        fields: {},
      },
    });

    const response = await appClient.index.$get(
      { query: { countryCode: "true" } },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getAccount).toHaveBeenCalledOnce();
    expect(getInquiry).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
    expect(response.headers.get("User-Country")).toBe("AR");
    expect(response.status).toBe(200);
  });

  it("returns ok kyc approved when panda id is present", async () => {
    await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
    const getInquiry = vi.spyOn(persona, "getInquiry");
    const getAccount = vi.spyOn(persona, "getAccount");

    const response = await appClient.index.$get(
      { query: {} },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getAccount).not.toHaveBeenCalled();
    expect(getInquiry).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
    expect(response.status).toBe(200);
  });

  it("returns ok kyc approved without template", async () => {
    await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(personaTemplate);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...personaTemplate,
      type: "account",
      attributes: {
        "country-code": "AR",
        "social-security-number": null,
        "address-street-1": "123 Main St",
        "address-street-2": null,
        "address-city": "New York",
        "address-subdivision": null,
        "address-postal-code": "10001",
        fields: {},
      },
    });

    const response = await appClient.index.$get(
      { query: {} },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, "itmpl_8uim4FvD5P3kFpKHX37CW817");
    expect(getAccount).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
    expect(response.headers.get("User-Country")).toBe("AR");
    expect(response.status).toBe(200);
  });

  it("resumes inquiry with template", async () => {
    const templateId = persona.PANDA_TEMPLATE;
    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
      ...personaTemplate,
      attributes: { ...personaTemplate.attributes, status: "pending" },
    });
    const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

    const response = await appClient.index.$get(
      { query: { templateId } },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, templateId);
    expect(resumeInquiry).toHaveBeenCalledWith(resumeTemplate.data.id);
    await expect(response.json()).resolves.toStrictEqual({
      inquiryId: resumeTemplate.data.id,
      sessionToken: resumeTemplate.meta["session-token"],
    });
    expect(response.status).toBe(200);
  });

  it("returns OTL link", async () => {
    const otl = "https://new-url.com";
    const generateOTL = vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
      ...OTLTemplate,
      meta: { ...OTLTemplate.meta, "one-time-link": otl },
    });
    let templateId;
    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(templateId);
    const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(OTLTemplate);

    const response = await appClient.index.$post(
      { json: {} },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, persona.CRYPTOMATE_TEMPLATE);
    expect(createInquiry).toHaveBeenCalledWith(account, undefined);
    expect(generateOTL).toHaveBeenCalledWith(resumeTemplate.data.id);
    await expect(response.json()).resolves.toStrictEqual({ otl, legacy: otl });
    expect(response.status).toBe(200);
  });

  it("returns OTL link when resuming inquiry", async () => {
    const templateId = "template";
    const otl = "https://resume-url.com";
    const generateOTL = vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
      ...OTLTemplate,
      meta: { ...OTLTemplate.meta, "one-time-link": otl },
    });

    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
      ...personaTemplate,
      attributes: { ...personaTemplate.attributes, status: "created" },
    });
    const response = await appClient.index.$post(
      { json: { templateId } },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, templateId);
    expect(generateOTL).toHaveBeenCalledWith(resumeTemplate.data.id);
    await expect(response.json()).resolves.toStrictEqual({ otl, legacy: otl });
    expect(response.status).toBe(200);
  });

  describe("application", () => {
    describe("with organization", () => {
      const owner = mnemonicToAccount("test test test test test test test test test test test kyc");
      const ownerHeaders: Headers = new Headers();
      const outsider = mnemonicToAccount("test test test test test test test test test test test bob");
      const outsiderHeaders: Headers = new Headers();

      let organizationId: string;

      beforeAll(async () => {
        const adminNonceResult = await auth.api.getSiweNonce({
          body: { walletAddress: owner.address, chainId: chain.id },
        });

        const statement = "I accept Exa terms and conditions";
        const ownerMessage = createSiweMessage({
          statement,
          resources: ["https://exactly.github.io/exa"],
          nonce: adminNonceResult.nonce,
          uri: `https://localhost`,
          address: owner.address,
          chainId: chain.id,
          scheme: "https",
          version: "1",
          domain: "localhost",
        });

        const ownerLogin = await auth.api.verifySiweMessage({
          body: {
            message: ownerMessage,
            signature: await owner.signMessage({ message: ownerMessage }),
            walletAddress: owner.address,
            chainId: chain.id,
          },
          request: new Request("https://localhost"),
          asResponse: true,
        });
        ownerHeaders.set("cookie", `${ownerLogin.headers.get("set-cookie")}`);

        const externalOrganization = await auth.api.createOrganization({
          headers: ownerHeaders,
          body: {
            name: "Organization",
            slug: "organization",
            keepCurrentActiveOrganization: false,
          },
        });
        organizationId = externalOrganization?.id ?? "";

        await auth.api
          .getSiweNonce({
            body: { walletAddress: outsider.address, chainId: chain.id },
          })
          .then((result) => {
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: result.nonce,
              uri: `https://localhost`,
              address: outsider.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain: "localhost",
            });
            return outsider.signMessage({ message }).then((signature) => {
              return auth.api
                .verifySiweMessage({
                  body: { message, signature, walletAddress: outsider.address, chainId: chain.id },
                  request: new Request("https://localhost"),
                  asResponse: true,
                })
                .then((response) => {
                  outsiderHeaders.set("cookie", response.headers.get("set-cookie") ?? "");
                });
            });
          });
      });

      describe("status", () => {
        it("returns status", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          const getApplicationStatus = vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
            id: "pandaId",
            applicationStatus: "approved",
            applicationReason: "",
          });
          const response = await appClient.application.$get(
            { query: {} },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          await expect(response.json()).resolves.toStrictEqual({
            code: "ok",
            legacy: "ok",
            status: "approved",
            reason: "",
          });
          expect(getApplicationStatus).toHaveBeenCalledWith("pandaId");
          expect(response.status).toBe(200);
        });

        it("returns not started when no panda id", async () => {
          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const response = await appClient.application.$get(
            { query: {} },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "not started",
            legacy: "not started",
          });
        });
      });

      describe("submit", () => {
        beforeAll(async () => {
          await database.insert(sources).values([
            {
              id: organizationId,
              config: {
                type: "uphold",
                secrets: { test: { key: "secret", type: "HMAC-SHA256" } },
                webhooks: { sandbox: { url: "https://exa.test", secretId: "test" } },
              },
            },
          ]);
        });

        it("returns ok when payload is valid and kyc is not started", async () => {
          const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(Buffer.from(JSON.stringify(canonicalize(applicationPayload)), "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://sandbox.exactly.app`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "sandbox.exactly.app",
          });
          const signature = await owner.signMessage({ message });

          const verify = {
            message,
            signature,
            walletAddress: owner.address,
            chainId: chain.id,
          };

          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  JSON.stringify({
                    id: "pandaId",
                    applicationStatus: "approved",
                  }),
                ).buffer,
              ),
          } as Response);

          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          const updatedCredential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const calls = mockFetch.mock.calls;
          const body = calls[0]?.[1]?.body;

          expect(response.status).toBe(200);
          expect(updatedCredential?.pandaId).toBe("pandaId");
          expect(mockFetch).toHaveBeenCalledWith(
            `${panda.baseURL}/issuing/applications/user`,
            expect.objectContaining({
              method: "POST",
            }),
          );
          expect(JSON.parse(body as string)).toStrictEqual({ ...applicationPayload, verify });
          await expect(response.json()).resolves.toStrictEqual({ status: "approved" });
        });

        it("returns 409 when kyc is already started", async () => {
          const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(Buffer.from(JSON.stringify(canonicalize(applicationPayload)), "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://sandbox.exactly.app`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "sandbox.exactly.app",
          });
          const signature = await owner.signMessage({ message });

          const verify = {
            message,
            signature,
            walletAddress: owner.address,
            chainId: chain.id,
          };

          const submitApplication = vi.spyOn(kyc, "submitApplication");

          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(409);
          await expect(response.json()).resolves.toStrictEqual({
            code: "already started",
          });
          expect(submitApplication).not.toHaveBeenCalled();
        });

        it("returns 400 when payload is invalid", async () => {
          const response = await appClient.application.$post(
            { json: {} as unknown as v.InferOutput<typeof kyc.SubmitApplicationRequest> },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toMatchObject({
            code: "bad request",
            legacy: "bad request",
            message: expect.any(Array), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
        });

        it("returns 400 if terms of service are not accepted", async () => {
          const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(Buffer.from(JSON.stringify(canonicalize(applicationPayload)), "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://sandbox.exactly.app`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "sandbox.exactly.app",
          });
          const signature = await owner.signMessage({ message });

          const verify = {
            message,
            signature,
            walletAddress: owner.address,
            chainId: chain.id,
          };
          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify, isTermsOfServiceAccepted: false } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
        });

        describe("with encrypted payload", () => {
          const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyZixoAuo015iMt+JND0y
usAvU2iJhtKRM+7uAxd8iXq7Z/3kXlGmoOJAiSNfpLnBAG0SCWslNCBzxf9+2p5t
HGbQUkZGkfrYvpAzmXKsoCrhWkk1HKk9f7hMHsyRlOmXbFmIgQHggEzEArjhkoXD
pl2iMP1ykCY0YAS+ni747DqcDOuFqLrNA138AxLNZdFsySHbxn8fzcfd3X0J/m/T
2dZuy6ChfDZhGZxSJMjJcintFyXKv7RkwrYdtXuqD3IQYakY3u6R1vfcKVZl0yGY
S2kN/NOykbyVL4lgtUzf0IfkwpCHWOrrpQA4yKk3kQRAenP7rOZThdiNNzz4U2BE
2wIDAQAB
-----END PUBLIC KEY-----`;

          function encrypt(payload: string) {
            const aesKey = crypto.randomBytes(32);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
            const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
            const tag = cipher.getAuthTag();
            const key = crypto.publicEncrypt(
              {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
              },
              aesKey,
            );

            return { key, iv, ciphertext, tag };
          }

          it("returns ok when  payload is valid", async () => {
            const encryptedPayload = encrypt(JSON.stringify(applicationPayload));
            const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(encryptedPayload.ciphertext)}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://sandbox.exactly.app`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain: "sandbox.exactly.app",
            });
            const signature = await owner.signMessage({ message });

            const verify = {
              message,
              signature,
              walletAddress: owner.address,
              chainId: chain.id,
            };

            await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
            const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce({
              ok: true,
              status: 200,
              arrayBuffer: () =>
                Promise.resolve(
                  new TextEncoder().encode(
                    JSON.stringify({
                      id: "pandaId",
                      applicationStatus: "approved",
                    }),
                  ).buffer,
                ),
            } as Response);

            const response = await appClient.application.$post(
              {
                json: {
                  key: encryptedPayload.key.toString("base64"),
                  iv: encryptedPayload.iv.toString("base64"),
                  ciphertext: encryptedPayload.ciphertext.toString("base64"),
                  tag: encryptedPayload.tag.toString("base64"),
                  verify,
                },
              },
              { headers: { "test-credential-id": account, SessionID: "fakeSession", encrypted: "true" } },
            );

            const updatedCredential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const calls = mockFetch.mock.calls;
            const body = calls[0]?.[1]?.body;

            expect(response.status).toBe(200);
            expect(updatedCredential?.pandaId).toBe("pandaId");
            expect(mockFetch).toHaveBeenCalledWith(
              `${panda.baseURL}/issuing/applications/user`,
              expect.objectContaining({
                method: "POST",
              }),
            );
            expect(JSON.parse(body as string)).toStrictEqual({
              key: encryptedPayload.key.toString("base64"),
              iv: encryptedPayload.iv.toString("base64"),
              ciphertext: encryptedPayload.ciphertext.toString("base64"),
              tag: encryptedPayload.tag.toString("base64"),
              verify,
            });
            await expect(response.json()).resolves.toStrictEqual({ status: "approved" });
          });

          it("returns 403 no organization", async () => {
            const encryptedPayload = encrypt(JSON.stringify(applicationPayload));
            const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(encryptedPayload.ciphertext)}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://sandbox.exactly.app`,
              address: outsider.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain: "sandbox.exactly.app",
            });

            const response = await appClient.application.$post(
              {
                json: {
                  key: encryptedPayload.key.toString("base64"),
                  iv: encryptedPayload.iv.toString("base64"),
                  ciphertext: encryptedPayload.ciphertext.toString("base64"),
                  tag: encryptedPayload.tag.toString("base64"),
                  verify: {
                    message,
                    signature: await outsider.signMessage({ message }),
                    walletAddress: outsider.address,
                    chainId: chain.id,
                  },
                },
              },
              { headers: { "test-credential-id": account, SessionID: "fakeSession", encrypted: "true" } },
            );

            expect(response.status).toBe(403);
          });
        });
      });

      describe("update", () => {
        it("returns ok when kyc is started", async () => {
          const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode("{}").buffer),
          } as Response);

          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          const calls = mockFetch.mock.calls;
          const body = calls[0]?.[1]?.body;

          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
          expect(mockFetch).toHaveBeenCalledWith(
            `${panda.baseURL}/issuing/applications/user/pandaId`,
            expect.objectContaining({
              method: "PATCH",
            }),
          );
          expect(JSON.parse(body as string)).toStrictEqual({ firstName: "john-updated" });
        });

        it("returns 400 when kyc is not started", async () => {
          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "not started",
            legacy: "not started",
          });
        });

        it("returns 400 when payload is invalid", async () => {
          const response = await appClient.application.$patch(
            {
              json: {
                address: {
                  line1: "123 main street",
                },
              } as unknown as v.InferOutput<typeof kyc.UpdateApplicationRequest>,
            },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "bad request",
            legacy: "bad request",
            message: expect.any(Array), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
        });
      });
    });
  });
});

const personaTemplate = {
  id: "test-id",
  type: "inquiry" as const,
  attributes: {
    status: "approved" as const,
    "reference-id": "ref-123",
    "name-first": "John",
    "name-middle": null,
    "name-last": "Doe",
    "email-address": "john@example.com",
    "phone-number": "+1234567890",
    birthdate: "1990-01-01",
    fields: { "input-select": { type: "choices", value: "John" } },
  } as const,
  relationships: {
    documents: { data: [{ type: "document", id: "1234567890" }] },
    account: { data: { id: "1234567890", type: "account" } } as const,
  },
};

const resumeTemplate = {
  data: {
    id: "test-id",
    type: "inquiry" as const,
    attributes: {
      status: "approved" as const,
      fields: {
        "name-first": { type: "string", value: "John" },
        "name-middle": { type: "string", value: null },
        "name-last": { type: "string", value: "Doe" },
        "email-address": { type: "string", value: "john@example.com" },
        "phone-number": { type: "string", value: "+1234567890" },
        birthdate: { type: "string", value: "1990-01-01" },
      },
      "reference-id": "ref-123",
    },
  },
  meta: {
    "session-token": "fakeSession",
  },
} as const;

const OTLTemplate = {
  data: {
    attributes: {
      status: "created",
      "reference-id": "ref-123",
    },
    id: "test-id",
    type: "inquiry",
  },
  meta: {
    "one-time-link": "a link",
    "one-time-link-short": "",
  },
} as const;

const applicationPayload = {
  firstName: "john",
  lastName: "doe",
  birthDate: "1990-01-15",
  nationalId: "123456789",
  countryOfIssue: "AA",
  email: "john.doe@example.com",
  phoneCountryCode: "1",
  phoneNumber: "5551234567",
  ipAddress: "192.168.1.1",
  occupation: "occupation",
  annualSalary: "1234",
  accountPurpose: "purpose",
  expectedMonthlyVolume: "1234",
  isTermsOfServiceAccepted: true,
  address: {
    line1: "123 main street",
    line2: "apt 1",
    city: "city",
    region: "region",
    postalCode: "1234",
    countryCode: "AA",
    country: "country",
  },
};
function canonicalize(json: unknown) {
  if (json === null || typeof json !== "object") return json;
  if (Array.isArray(json)) return null;
  const sortedKeys = Object.keys(json).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize((json as Record<string, unknown>)[key]);
  }
  return result;
}
