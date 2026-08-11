import "../mocks/sentry";

import { parse } from "valibot";
import { padHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import { usdcAddress } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import createPanda, * as Panda from "../../utils/panda";
import createPersona from "../../utils/persona";
import ServiceError from "../../utils/ServiceError";

const chainMock = vi.hoisted(() => ({ id: 0, testnet: true as boolean | undefined }));

vi.mock("@exactly/common/generated/chain", async (importOriginal) => ({
  ...(await importOriginal()),
  default: Object.assign(chainMock, baseSepolia, {
    rpcUrls: { ...baseSepolia.rpcUrls, alchemy: baseSepolia.rpcUrls.default },
  }),
}));

const panda = { ...Panda, ...createPanda({ key: "panda", url: "https://panda.test" }) };
const persona = createPersona("persona", "https://persona.test");

describe("panda request", () => {
  it("extracts entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Not Found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const rejection = panda.getUser("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "user" });
  });

  it("extracts card entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Not Found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const rejection = panda.getCard("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "card" });
  });

  it("lists a user's cards", async () => {
    const cards = [
      {
        id: "3c90c3cc-0d44-4b50-8888-8dd25736052a",
        status: "active",
        last4: "4242",
        expirationMonth: "9",
        expirationYear: "2029",
      },
    ];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(cards)).buffer),
    } as Response);

    await expect(panda.getCards("e5cd86bb-a19e-4a66-9728-9e6c5d97e616")).resolves.toStrictEqual(cards);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/cards?userId=e5cd86bb-a19e-4a66-9728-9e6c5d97e616&limit=100"),
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("business application", () => {
  it("prefers account fields over inquiry fields", async () => {
    const account = parse(Address, padHex("0xb0b", { size: 20 }));
    const fields = {
      i_company_name: { value: "Account Acme" },
      company_description: { value: "Account software" },
      company_industry: { value: "541511" },
      company_registration_number: { value: "123" },
      company_tax_id: { value: "456" },
      company_website: { value: "https://example.com" },
      company_type: { value: "corporation" },
      company_expected_spend: { value: 1000 },
      i_auth_user_name: { value: "Jane" },
      i_auth_user_last_name: { value: "Doe" },
      birth_date: { value: "1990-01-01" },
      id_number: { value: "123456789" },
      id_country: { value: "US" },
      collected_email_address: { value: "jane@example.com" },
      terms_and_conditions: { value: true },
      street_1: { value: "1 Main St" },
      city: { value: "New York" },
      subdivision: { value: "NY" },
      postal_code: { value: "10001" },
      country_code: { value: "US" },
      street_1_1: { value: "1 Main St" },
      city_1: { value: "New York" },
      subdivision_1: { value: "NY" },
      postal_code_1: { value: "10001" },
      country_code_1: { value: "US" },
    };
    vi.spyOn(persona, "getInquiry").mockResolvedValue({
      id: "inquiry-id",
      type: "inquiry",
      attributes: {
        status: "completed",
        "reference-id": "reference-id",
        fields: { "company-description": { value: "Inquiry software" } },
      },
    });
    vi.spyOn(persona, "getAccount").mockResolvedValue({
      id: "account-id",
      type: "account",
      attributes: { "reference-id": "reference-id", fields },
      relationships: { "account-type": { data: { id: "acttp_company" } } },
    });

    const application = await panda.businessApplication("reference-id", account, "127.0.0.1", persona);

    expect(application.entity.description).toBe("Account software");
  });
});

describe("withdrawals", () => {
  const account = parse(Address, padHex("0xb0b", { size: 20 }));

  it("requests testnet withdrawals", async () => {
    chainMock.id = baseSepolia.id;
    chainMock.testnet = true;
    const parameters = [account, account, "100", account, 1, [1, 2], "0x1234"];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ parameters }));

    await expect(panda.getWithdrawal(100n, account, account)).resolves.toStrictEqual({ parameters });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=0x29684075a3C86ea11D9964BcAf0F956e801396bD&amount=100&recipientAddress=${account}&adminAddress=${account}&chainId=${baseSepolia.id}`,
      ),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("requests mainnet withdrawals", async () => {
    chainMock.id = base.id;
    chainMock.testnet = false;
    const parameters = [account, account, "100", account, 1, [1, 2], "0x1234"];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ parameters }));

    await expect(panda.getWithdrawal(100n, account, account)).resolves.toStrictEqual({ parameters });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `/issuing/tenants/signatures/withdrawals?token=${parse(Address, usdcAddress)}&amount=100`,
      ),
      expect.objectContaining({ method: "GET" }),
    );
    chainMock.testnet = true;
  });
});

describe("create card", () => {
  const card = {
    id: "card-id",
    userId: "user-id",
    type: "virtual",
    status: "active",
    limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
    last4: "1234",
    expirationMonth: "12",
    expirationYear: "2030",
  };

  it("sends sandbox card art on base sepolia", async () => {
    chainMock.id = baseSepolia.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", PLATINUM_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: PLATINUM_PRODUCT_ID, virtualCardArt: "0c515d7eb0a140fa8f938f8242b0780a" },
        }),
      }),
    );
  });

  it("sends sandbox card art on optimism sepolia", async () => {
    chainMock.id = optimismSepolia.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", SIGNATURE_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "0c515d7eb0a140fa8f938f8242b0780a" },
        }),
      }),
    );
  });

  it("sends platinum card art on optimism", async () => {
    chainMock.id = optimism.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", PLATINUM_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: PLATINUM_PRODUCT_ID, virtualCardArt: "81e42f27affd4e328f19651d4f2b438e" },
        }),
      }),
    );
  });

  it("sends signature card art on base", async () => {
    chainMock.id = base.id;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(card)).buffer),
    } as Response);

    await expect(panda.createCard("user-id", SIGNATURE_PRODUCT_ID)).resolves.toStrictEqual(card);
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining("/issuing/users/user-id/cards"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          type: "virtual",
          status: "active",
          limit: { amount: 1_000_000, frequency: "per7DayPeriod" },
          configuration: { productId: SIGNATURE_PRODUCT_ID, virtualCardArt: "398c4919514b4ec4927e6a9114a4c816" },
        }),
      }),
    );
  });
});

describe("siwe", () => {
  it("returns the generated nonce", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode('{"nonce":"Db2ItfTPLuZ2dV0ZQ"}').buffer),
    } as Response);

    await expect(panda.getNonce("e5cd86bb-a19e-4a66-9728-9e6c5d97e616")).resolves.toStrictEqual({
      nonce: "Db2ItfTPLuZ2dV0ZQ",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users/e5cd86bb-a19e-4a66-9728-9e6c5d97e616/signatures/generate-nonce"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("verify message", async () => {
    const payload = {
      authType: "siwe" as const,
      message: "I authorize the account 0xabc to be linked with the card ending in 1234 for my user (e5cd86bb).",
      signature: "0x57d2c1f0c01b9173e080bd3cdd40600924cc0c4c31dfe45353d9d967c35d16944a",
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as Response);

    await expect(panda.verify("e5cd86bb-a19e-4a66-9728-9e6c5d97e616", payload)).resolves.toStrictEqual({});
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("/issuing/users/e5cd86bb-a19e-4a66-9728-9e6c5d97e616/signatures/verify"),
      expect.objectContaining({ method: "PUT", body: JSON.stringify(payload) }),
    );
  });
});
