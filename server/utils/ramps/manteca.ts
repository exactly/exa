import { captureException, withScope } from "@sentry/core";
import {
  array,
  boolean,
  object,
  optional,
  parse,
  parseJson,
  picklist,
  pipe,
  record,
  safeParse,
  string,
  uuid,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
} from "valibot";
import {
  concat,
  formatUnits,
  InvalidParamsRpcError,
  isAddressEqual,
  isHash,
  numberToHex,
  parseEventLogs,
  parseUnits,
  stringToHex,
  withRetry,
  type Log,
} from "viem";
import { getUserOperationReceipt, UserOperationReceiptNotFoundError } from "viem/account-abstraction";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import { Address, type Hash } from "@exactly/common/validation";

import { MantecaCountryCode } from "../persona";
import publicClient from "../publicClient";
import ServiceError from "../ServiceError";

import type createPersona from "../persona";

export const name = "manteca" as const;

export default function manteca(key: string, url: string) {
  return {
    acceptTermsAndConditions,
    balances,
    convertBalanceToUsdc,
    createOrder,
    executeQRPayment,
    getDepositDetails,
    getLimits,
    getMinimum,
    getPaymentLock,
    getProvider,
    getQRRefund,
    getQuote,
    getSettlement,
    getSettlements,
    getSynthetic,
    getUser,
    initiateOnboarding,
    lockQRPayment,
    onboarding,
    refundQRPayment,
    uploadIdentityFile,
    withdrawBalance,
    withdrawOrder,
  };

  async function acceptTermsAndConditions(userAnyId: string) {
    return await request(object({}), `/crypto/v2/onboarding-actions/accept-tyc`, {}, { userAnyId }, "POST", 10_000);
  }
  async function balances(userAnyId: string) {
    return await request(BalancesResponse, `/crypto/v2/user-balances/${userAnyId}`, {}, undefined, "GET", 10_000);
  }
  async function convertBalanceToUsdc(userNumberId: string, against: string) {
    const userBalances = await balances(userNumberId);
    const assetBalance = userBalances.balance[against as keyof typeof userBalances.balance];
    if (!assetBalance) throw new Error("asset balance not found");

    await createOrder({
      userAnyId: userNumberId,
      side: "BUY",
      disallowDebt: true,
      asset: "USDC",
      against,
      againstAmount: assetBalance,
    }).catch((error: unknown) => {
      if (
        error instanceof ServiceError &&
        typeof error.cause === "string" &&
        error.cause.includes(MantecaApiErrorCodes.INVALID_ORDER_SIZE)
      ) {
        throw new Error(ErrorCodes.INVALID_ORDER_SIZE);
      }
      throw error;
    });
  }
  async function createOrder(order: InferInput<typeof Order>) {
    return await request(OrderResponse, "/crypto/v2/orders", {}, order, "POST", 10_000);
  }
  async function executeQRPayment(qrCode: string, externalId: string) {
    return await request(
      SyntheticResponse,
      "/crypto/v2/synthetics/qr-payment",
      {},
      { qrCode, externalId },
      "POST",
      10_000,
    ).catch(async (error: unknown) => {
      if (
        error instanceof ServiceError &&
        typeof error.cause === "string" &&
        (error.cause.includes(MantecaApiErrorCodes.SYNTHETIC_EXISTS) ||
          error.cause.includes(MantecaApiErrorCodes.DUPLICATE_REQUEST))
      ) {
        const synthetic = await getSynthetic(externalId);
        if (synthetic) return synthetic;
      }
      throw error;
    });
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping
  async function forwardFileToURL(sourceURL: string, destinationURL: string): Promise<void> {
    const abort = new AbortController();
    const timeout = setTimeout(() => {
      abort.abort();
    }, 10_000);

    try {
      const source = await fetch(sourceURL, { headers: { "accept-encoding": "identity" }, signal: abort.signal });
      if (!source.ok || !source.body) throw new Error(`Source fetch failed: ${source.status} ${source.statusText}`);
      const sourceContentType = source.headers.get("content-type") ?? "application/octet-stream";
      const sourceContentLength = source.headers.get("content-length");
      const readable = source.body;
      const headers = new Headers({ "content-type": sourceContentType });
      if (sourceContentLength) headers.set("content-length", sourceContentLength);

      const destination = await fetch(destinationURL, {
        method: "PUT",
        headers,
        body: readable,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore not supported by react-native
        duplex: "half",
        signal: abort.signal,
      });

      if (!destination.ok) {
        const errorText = await destination.text().catch(() => "no error text");
        throw new Error(
          `Destination upload failed: ${destination.status} ${destination.statusText}${
            errorText ? ` – ${errorText}` : ""
          }`,
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  function getExchange(countryCode: string): (typeof Exchange)[number] {
    if (isDevelopment()) return "ARGENTINA";
    const result = safeParse(picklist(MantecaCountryCode), countryCode);
    if (!result.success) throw new Error(`Invalid country: ${countryCode}`);
    return ExchangeByCountry[result.output];
  }
  async function getLimits(userNumberId: string) {
    return await request(LimitsResponse, `/crypto/v2/limits/${userNumberId}`, {}, undefined, "GET", 10_000);
  }
  function getNationality(countryCode: string): string {
    if (isDevelopment()) return "Argentina";
    const result = safeParse(picklist(MantecaCountryCode), countryCode);
    if (!result.success) throw new Error(`Invalid country: ${countryCode}`);
    return Nationality[result.output];
  }
  async function getMinimum() {
    const limits = await request(OperationLimits, "/crypto/v2/info/operation-limits", {}, undefined, "GET", 5000).catch(
      (error: unknown) => {
        captureException(error, { level: "warning" });
      },
    );
    if (!limits) return;
    const { currency, min } = limits.order;
    if (currency === "USD") return min;
    captureException(new Error("unsupported qr minimum currency"), {
      level: "warning",
      contexts: { order: { currency, min } },
    });
  }
  async function getPaymentLock(code: string) {
    return await request(QRPaymentResponse, `/crypto/v2/payment-locks/${code}`, {}, undefined, "GET", 10_000).catch(
      (error: unknown) => {
        if (error instanceof ServiceError && error.status === 404) return;
        if (
          error instanceof ServiceError &&
          typeof error.cause === "string" &&
          error.cause.includes(MantecaApiErrorCodes.EXPIRED_LOCK)
        ) {
          return null;
        }
        throw error;
      },
    );
  }
  async function getProvider(account: Address, countryCode?: string) {
    if (Supported[chain.id] !== "OPTIMISM") {
      captureException(new Error("manteca not supported chain id"), { level: "error", contexts: { chain } });
      return { onramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
    }

    const currencies = getSupported(countryCode);
    const mantecaUser = await getUser(account);
    if (!mantecaUser) {
      return { onramp: { currencies }, status: "NOT_STARTED" as const };
    }
    if (mantecaUser.status === "ACTIVE") {
      const exchange = mantecaUser.exchange;
      const limits = await getLimits(mantecaUser.numberId).catch((error: unknown) => {
        captureException(error, { level: "error" });
      });
      const exchangeLimits = limits?.find((limit) => limit.type === "EXCHANGE");
      return {
        onramp: {
          currencies: CurrenciesByExchange[exchange],
          ...(exchangeLimits
            ? {
                limits: {
                  monthly: {
                    available: exchangeLimits.availableMonthlyLimit,
                    limit: exchangeLimits.monthlyLimit,
                    symbol: exchangeLimits.asset,
                  },
                  yearly: {
                    available: exchangeLimits.availableYearlyLimit,
                    limit: exchangeLimits.yearlyLimit,
                    symbol: exchangeLimits.asset,
                  },
                },
              }
            : {}),
        },
        status: "ACTIVE" as const,
      };
    }
    if (mantecaUser.status === "INACTIVE") {
      return { onramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
    }
    const hasFailedTasks = Object.values(mantecaUser.onboarding).some(
      (task) => task.required && task.status === "FAILED",
    );
    if (hasFailedTasks) {
      withScope((scope) => {
        scope.addEventProcessor((event) => {
          if (event.exception?.values?.[0]) event.exception.values[0].type = "has failed tasks";
          return event;
        });
        captureException(new Error("has failed tasks"), {
          level: "warning",
          fingerprint: ["{{ default }}", "has failed tasks"],
          contexts: { onboarding: mantecaUser.onboarding },
        });
      });
      return { onramp: { currencies }, status: "CONTACT_SUPPORT" as const };
    }
    const hasPendingTasks = Object.values(mantecaUser.onboarding).some(
      (task) => task.required && task.status === "PENDING",
    );
    if (hasPendingTasks) {
      withScope((scope) => {
        scope.addEventProcessor((event) => {
          if (event.exception?.values?.[0]) event.exception.values[0].type = "has pending tasks";
          return event;
        });
        captureException(new Error("has pending tasks"), {
          level: "warning",
          fingerprint: ["{{ default }}", "has pending tasks"],
          contexts: { onboarding: mantecaUser.onboarding },
        });
      });
      return { onramp: { currencies }, status: "NOT_STARTED" as const };
    }
    return { onramp: { currencies }, status: "ONBOARDING" as const };
  }
  async function getQRRefund(userOpHash: string) {
    return await request(
      WithdrawResponse,
      `/crypto/v2/withdraws/refund-${userOpHash}`,
      {},
      undefined,
      "GET",
      10_000,
    ).catch((error: unknown) => {
      if (
        error instanceof ServiceError &&
        typeof error.cause === "string" &&
        error.cause.includes(MantecaApiErrorCodes.WITHDRAW_NOT_FOUND)
      ) {
        return null;
      }
      throw error;
    });
  }
  async function getQuote(coinPair: string) {
    const quote = await request(
      QuoteResponse,
      `/crypto/v2/prices/direct/${coinPair}`,
      {},
      undefined,
      "GET",
      10_000,
    ).catch((error: unknown) => {
      captureException(error, { level: "error" });
    });
    if (!quote) return;
    return { buyRate: quote.buy, sellRate: quote.sell };
  }
  async function getSettlement(asset: string) {
    const { [asset]: settlement } = await getSettlements();
    if (!settlement) throw new Error(ErrorCodes.NOT_SUPPORTED_CURRENCY);
    return settlement;
  }
  async function getSettlements() {
    const { banking } = await request(CompanyResponse, "/crypto/v2/company", {}, undefined, "GET", 10_000);
    const network = Supported[chain.id];
    return Object.fromEntries(
      Object.entries(SettlementEntity).flatMap(([asset, entity]) => {
        const settlement = banking.addresses.find(
          ({ acceptedNetworks, address, legalEntity, type }) =>
            type === "SETTLEMENT" &&
            legalEntity === entity &&
            network !== undefined &&
            acceptedNetworks.includes(network) &&
            safeParse(Address, address).success,
        );
        return settlement ? [[asset, parse(Address, settlement.address)] as const] : [];
      }),
    );
  }
  async function getSynthetic(externalId: string) {
    return await request(SyntheticResponse, `/crypto/v2/synthetics/${externalId}`, {}, undefined, "GET", 10_000).catch(
      (error: unknown) => {
        if (
          error instanceof ServiceError &&
          typeof error.cause === "string" &&
          error.cause.includes(MantecaApiErrorCodes.SYNTHETIC_NOT_FOUND)
        ) {
          return null;
        }
        throw error;
      },
    );
  }
  function getSupported(countryCode?: string): (typeof MantecaCurrency)[number][] {
    if (!countryCode) return [];
    if (isDevelopment()) return CurrenciesByExchange.ARGENTINA;
    const result = safeParse(picklist(MantecaCountryCode), countryCode);
    if (!result.success) return [];
    return CurrenciesByExchange[ExchangeByCountry[result.output]];
  }
  async function getUser(account: Address): Promise<InferInput<typeof UserResponse> | null> {
    const externalId = account.replace("0x", "");
    return await request(UserResponse, `/crypto/v2/users/${externalId}`, {}, undefined, "GET", 10_000).catch(
      (error: unknown) => {
        if (
          error instanceof ServiceError &&
          typeof error.cause === "string" &&
          error.cause.includes(MantecaApiErrorCodes.USER_NOT_FOUND)
        ) {
          return null;
        }
        throw error;
      },
    );
  }
  async function initiateOnboarding(user: InferInput<typeof UserOnboarding>) {
    return await request(NewUserResponse, "/crypto/v2/onboarding-actions/initial", {}, user, "POST", 10_000);
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping
  function isDevelopment(): boolean {
    return DevelopmentChainIds.includes(chain.id as (typeof DevelopmentChainIds)[number]);
  }
  async function lockQRPayment(lock: InferInput<typeof PaymentLock>) {
    const body = { ...lock, sourceNetwork: Supported[chain.id] };
    return await request(QRPaymentResponse, "/crypto/v2/payment-locks", {}, body, "POST", 10_000).catch(
      (error: unknown) => {
        if (error instanceof ServiceError && typeof error.cause === "string") {
          if (error.cause.includes(MantecaApiErrorCodes.INVALID_AMOUNT)) throw new Error(ErrorCodes.INVALID_AMOUNT);
          if (error.cause.includes(MantecaApiErrorCodes.INVALID_QR)) throw new Error(ErrorCodes.INVALID_QR);
        }
        throw error;
      },
    );
  }
  async function onboarding(account: Address, credentialId: string, persona: PersonaService) {
    const externalId = account.replace("0x", "");
    if (Supported[chain.id] !== "OPTIMISM") {
      captureException(new Error("manteca not supported chain id"), { level: "error", contexts: { chain } });
      throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
    }

    const mantecaUser = await getUser(account);
    if (mantecaUser?.status === "ACTIVE") return;
    if (mantecaUser?.status === "INACTIVE") throw new Error(ErrorCodes.MANTECA_USER_INACTIVE);
    const personaAccount = await persona.getAccount(credentialId, "manteca");
    if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);
    const countryCode = personaAccount.attributes["country-code"];

    const identityDocument = await persona.getDocumentForManteca(
      personaAccount.attributes.fields.documents.value,
      countryCode,
    );
    if (!identityDocument) {
      captureException(new Error("no identity document"), {
        level: "error",
        contexts: { details: { account, credentialId } },
      });
      throw new Error(ErrorCodes.NO_DOCUMENT);
    }

    if (!mantecaUser) {
      await initiateOnboarding({
        email: personaAccount.attributes["email-address"],
        legalId: personaAccount.attributes.fields.tin.value,
        externalId,
        type: "INDIVIDUAL",
        exchange: getExchange(countryCode),
        personalData: {
          birthDate: personaAccount.attributes.fields.birthdate.value,
          nationality: getNationality(countryCode),
          phoneNumber: personaAccount.attributes.fields.phone_number.value,
          surname: personaAccount.attributes.fields.name.value.last.value,
          name: personaAccount.attributes.fields.name.value.first.value,
          maritalStatus: "Soltero", // cspell:ignore soltero
          sex:
            personaAccount.attributes.fields.sex_1.value === "Male"
              ? "M"
              : personaAccount.attributes.fields.sex_1.value === "Female"
                ? "F"
                : "X",
          isFacta: !personaAccount.attributes.fields.isnotfacta.value, // cspell:ignore isnotfacta
          isPep: false,
          isFep: false,
          work: personaAccount.attributes.fields.economic_activity.value,
        },
      }).catch((error: unknown) => {
        if (
          error instanceof ServiceError &&
          typeof error.cause === "string" &&
          error.cause.includes(MantecaApiErrorCodes.INVALID_LEGAL_ID)
        ) {
          throw new Error(ErrorCodes.INVALID_LEGAL_ID);
        }
        throw error;
      });
    }

    const document = await persona.getDocument(identityDocument.id_document_id.value);
    const frontDocumentURL = document.attributes["front-photo"]?.url;
    if (!frontDocumentURL) throw new Error("front document URL not found");
    const backDocumentURL = document.attributes["back-photo"]?.url;

    const results = await Promise.allSettled([
      uploadIdentityFile(
        externalId,
        "FRONT",
        document.attributes["front-photo"]?.filename ?? "front-photo.jpg",
        frontDocumentURL,
      ),
      uploadIdentityFile(
        externalId,
        "BACK",
        document.attributes["back-photo"]?.filename ?? "back-photo.jpg",
        backDocumentURL,
      ),
      acceptTermsAndConditions(externalId),
    ]);

    for (const result of results) {
      result.status === "rejected" && captureException(result.reason, { level: "error", extra: { account } });
    }
  }
  async function refundQRPayment(userOpHash: string, address: Address, amount: bigint, gas: "exa" | "user") {
    const network = Supported[chain.id];
    if (!network) throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
    const destination = { address, network };
    const { [network]: lock } = await request(
      WithdrawLocks,
      "/crypto/v2/withdraw-locks",
      {},
      { userAnyId: "Exactly-argentina", asset: "USDC", destination },
      "POST",
      10_000,
    );
    if (!lock) throw new Error("missing withdraw lock");
    const cost = parseUnits(lock.cost, 6);
    if (gas === "user" && amount <= cost) {
      captureException(new Error("qr refund below withdraw cost"), {
        level: "warning",
        contexts: { refund: { userOpHash, address, amount: String(amount), cost: String(cost) } },
      });
      return null;
    }
    const withdraw = await withdrawOrder({
      externalId: `refund-${userOpHash}`,
      userAnyId: "Exactly-argentina",
      legalEntity: "WALLET_ARG",
      asset: "USDC",
      amount: formatUnits(gas === "exa" ? amount + cost : amount, 6),
      withdrawLockCode: lock.code,
      destination,
    }).catch(async (error: unknown) => {
      if (
        error instanceof ServiceError &&
        typeof error.cause === "string" &&
        error.cause.includes(MantecaApiErrorCodes.WITHDRAW_EXISTS)
      ) {
        const existing = await getQRRefund(userOpHash);
        if (existing) return existing;
      }
      throw error;
    });
    await balances("Exactly-argentina")
      .then(
        ({
          balances: {
            WALLET_ARG: { USDC: balance },
          },
        }) => {
          // TODO size the refund cash with the team
          if (parseUnits(balance, 6) < 1_000_000_000n) {
            captureException(new Error("qr refund balance low"), {
              level: "warning",
              contexts: { refund: { balance, userOpHash, withdraw: withdraw.id } },
            });
          }
        },
      )
      .catch((error: unknown) => {
        captureException(error, { level: "error", contexts: { refund: { userOpHash, withdraw: withdraw.id } } });
      });
    return withdraw;
  }
  async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
    schema: BaseSchema<TInput, TOutput, TIssue>,
    path: `/${string}`,
    headers = {},
    body?: unknown,
    method: "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
    timeout = 10_000,
  ) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: {
        ...headers,
        "md-api-key": key,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    });

    if (!response.ok) {
      const raw = await response.text();
      let type: string | undefined;
      let detail: string | undefined;
      try {
        const payload = JSON.parse(raw) as unknown;
        if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
          const p = payload as Record<string, unknown>;
          if (typeof p.internalStatus === "string" && p.internalStatus)
            type = p.internalStatus.toLowerCase().replaceAll(/(?:^|_)\w/g, (c) => c.slice(-1).toUpperCase());
          if (Array.isArray(p.errors) && typeof p.errors[0] === "string" && p.errors[0])
            detail = p.errors[0].replace(/(has wrong value).*/, "$1");
          else if (typeof p.message === "string" && p.message) detail = p.message;
        }
      } catch {} // eslint-disable-line no-empty -- non-json manteca errors use fallback classification
      throw new ServiceError("Manteca", response.status, raw, type, detail);
    }
    const rawBody = await response.arrayBuffer();
    if (rawBody.byteLength === 0) return parse(schema, {});
    return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
  }
  async function uploadIdentityFile(
    userAnyId: string,
    side: "BACK" | "FRONT",
    fileName: string,
    documentURL?: null | string,
  ): Promise<void> {
    if (!documentURL) return;
    await withRetry(
      async () => {
        const { url: presignedURL } = await request(
          UploadIdentityFileResponse,
          "/crypto/v2/onboarding-actions/upload-identity-image",
          {},
          { userAnyId, fileName, side },
          "POST",
          10_000,
        );
        await forwardFileToURL(documentURL, presignedURL);
      },
      {
        delay: 1000,
        retryCount: 2,
        shouldRetry: ({ error }) => {
          captureException(error, { level: "warning", fingerprint: ["{{ default }}", "upload identity file"] });
          return true;
        },
      },
    );
  }
  async function withdrawBalance(userNumberId: string, asset: string, address: Address) {
    const userBalances = await balances(userNumberId);
    const assetBalance = userBalances.balance[asset as keyof typeof userBalances.balance];
    if (!assetBalance) throw new Error("asset balance not found");

    const supportedChain = Supported[chain.id];
    if (!supportedChain) {
      captureException(new Error("manteca not supported chain id"), { level: "error", contexts: { chain } });
      throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
    }

    await withdrawOrder({
      userAnyId: userNumberId,
      asset,
      amount: assetBalance,
      destination: { address, network: supportedChain },
    });
  }
  async function withdrawOrder(withdraw: InferInput<typeof Withdraw>) {
    return await request(WithdrawResponse, "/crypto/v2/withdraws", {}, withdraw, "POST", 10_000);
  }
  // eslint-disable-next-line unicorn/consistent-function-scoping
  function getDepositDetails(currency: (typeof MantecaCurrency)[number], exchange: (typeof Exchange)[number]) {
    const network = `${currency}-${exchange}` as const;
    switch (network) {
      case "ARS-ARGENTINA":
        return [
          {
            beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
            cbu: "0000234100000000000529",
            depositAlias: "exa.ars",
            displayName: "CVU",
            estimatedProcessingTime: "300",
            fee: "0.0",
            network: "ARG_FIAT_TRANSFER",
          } as const,
        ];
      case "USD-ARGENTINA":
        return [
          {
            beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
            cbu: "4310009942700000124934",
            depositAlias: "exa.usd",
            displayName: "CBU",
            estimatedProcessingTime: "300",
            fee: "0.0",
            network: "ARG_FIAT_TRANSFER",
          } as const,
        ];
      case "BRL-BRAZIL":
        return [
          {
            beneficiaryName: "JUST PAGAMENTOS LTDA", // cspell:ignore PAGAMENTOS LTDA
            merchantCity: "São Paulo",
            displayName: "PIX KEY",
            estimatedProcessingTime: "300",
            fee: "0.0",
            network: "PIX",
            pixKey: "100d6f24-c507-43a1-935c-ba3fb9d1c16d", // gitleaks:allow public PIX deposit key; not a credential
            postalCode: "09751-000",
          } as const,
        ];
      default:
        captureException(new Error("manteca not supported currency"), {
          level: "error",
          contexts: { details: { currency, exchange } },
        });
        throw new Error(ErrorCodes.NOT_SUPPORTED_CURRENCY);
    }
  }
}

// #region schemas
export const Currency = ["ARS", "BRL", "USD"] as const;
const DevelopmentChainIds = [baseSepolia.id, optimismSepolia.id] as const;
const Network = ["BASE", "OPTIMISM"] as const;

const Supported: Record<number, (typeof Network)[number] | undefined> = {
  [base.id]: "BASE",
  [baseSepolia.id]: "BASE",
  [optimism.id]: "OPTIMISM",
  [optimismSepolia.id]: "OPTIMISM",
} as const;

export const WithdrawStatus = ["PENDING", "EXECUTED", "CANCELLED"] as const;
export const Withdraw = object({
  externalId: optional(string()),
  userAnyId: string(),
  legalEntity: optional(string()),
  asset: string(),
  amount: string(),
  withdrawLockCode: optional(string()),
  destination: object({ address: Address, network: picklist(Network) }),
});

const WithdrawLocks = record(string(), object({ code: string(), cost: string() }));

export const WithdrawResponse = object({
  id: string(),
  numberId: string(),
  userExternalId: optional(string()),
  status: picklist(WithdrawStatus),
});

export const Order = object({
  externalId: optional(string()),
  userAnyId: string(),
  side: picklist(["BUY", "SELL"]),
  asset: string(),
  against: string(),
  againstAmount: string(),
  disallowDebt: boolean(),
});

export const OrderStatus = ["PENDING", "COMPLETED", "CANCELLED"] as const;
export const OrderResponse = object({
  id: string(),
  numberId: string(),
  userExternalId: optional(string()),
  status: picklist(OrderStatus),
});

export const OnRampSynthetic = object({
  userAnyId: string(),
  asset: string(),
  against: string(),
  againstAmount: string(),
  priceCode: optional(string()),
  disallowDebt: boolean(),
  destination: object({
    address: Address,
    network: picklist(["ETHEREUM", "BINANCE", "POLYGON", "OPTIMISM", "INTERNAL"]),
  }),
});

export const PaymentLock = object({
  paymentDestination: string(),
  amount: optional(string()),
  against: optional(string()),
  sender: object({ legalIdNationality: string(), legalId: string(), name: string(), surname: string() }),
  sourceAddress: Address,
});

export const QRPaymentResponse = object({
  code: optional(string()),
  type: string(),
  companyId: string(),
  userId: string(),
  userNumberId: string(),
  userExternalId: optional(string()),
  sender: optional(object({ legalId: string() })),
  paymentRecipientName: optional(string()),
  paymentRecipientLegalId: optional(string()),
  paymentAssetAmount: string(),
  paymentAsset: string(),
  paymentPrice: optional(string()),
  paymentAgainstAmount: string(),
  expireAt: string(),
  creationTime: string(),
});

export const QRRecord = pipe(
  string(),
  parseJson(),
  object({ account: Address, amount: string(), asset: string(), expireAt: string() }),
);

export const SyntheticStatus = ["STARTING", "ACTIVE", "WAITING", "COMPLETED", "CANCELLED"] as const;
export const SyntheticResponse = object({
  id: string(),
  numberId: string(),
  externalId: optional(string()),
  status: picklist(SyntheticStatus),
  type: string(),
});

const CompanyResponse = object({
  banking: object({
    addresses: array(
      object({
        acceptedNetworks: optional(array(string()), []),
        address: string(),
        legalEntity: string(),
        type: string(),
      }),
    ),
  }),
});

const SettlementEntity = { ARS: "WALLET_ARG", BRL: "CRYPTO_GLOBAL" };

export const QuoteResponse = object({ ticker: string(), timestamp: string(), buy: string(), sell: string() });

export const LimitType = ["EXCHANGE", "REMITTANCE"] as const;
export const LimitsResponse = array(
  object({
    exchangeCountry: string(),
    asset: string(),
    type: picklist(LimitType),
    yearlyLimit: string(),
    availableYearlyLimit: string(),
    monthlyLimit: string(),
    availableMonthlyLimit: string(),
  }),
);

const OperationLimits = object({ order: object({ min: string(), max: optional(string()), currency: string() }) });

export const BalancesResponse = object({
  userId: string(),
  userNumberId: string(),
  userExternalId: optional(string()),
  balance: object({
    ARS: optional(string()),
    USD: optional(string()),
    BRL: optional(string()),
    CLP: optional(string()),
    COP: optional(string()),
    PUSD: optional(string()),
    CRC: optional(string()),
    MXN: optional(string()),
    PHP: optional(string()),
    BOB: optional(string()),

    USDC: optional(string()),
  }),
  balances: optional(object({ WALLET_ARG: optional(object({ USDC: optional(string(), "0") }), {}) }), {}),
  updatedAt: string(),
});

const onboardingTaskStatus = ["PENDING", "COMPLETED", "FAILED", "IN_PROGRESS"] as const;
const OnboardingTaskInfo = optional(
  object({
    required: boolean(),
    status: picklist(onboardingTaskStatus),
    rejectionReason: optional(string()),
  }),
);
export const UserOnboardingTasks = object({
  EMAIL_VALIDATION: OnboardingTaskInfo,
  IDENTITY_DECLARATION: OnboardingTaskInfo,
  BASIC_PERSONAL_DATA_DEFINITION: OnboardingTaskInfo,
  TYC_ACCEPTANCE: OnboardingTaskInfo,
  POLITICAL_CONSTRAINTS_VALIDATION: OnboardingTaskInfo,
  SECURITY_VALIDATION: OnboardingTaskInfo,
  BANK_ACCOUNT_DEFINITION: OnboardingTaskInfo,
  FEP_DOCUMENTATION_VALIDATION: OnboardingTaskInfo,
  PEP_DOCUMENTATION_VALIDATION: OnboardingTaskInfo,
  SELFIE_VALIDATION: OnboardingTaskInfo,
  IDENTITY_VALIDATION: OnboardingTaskInfo,
});

export const Exchange = [
  "ARGENTINA",
  "CHILE",
  "BRAZIL",
  "COLOMBIA",
  "PANAMA",
  "COSTA_RICA", // cspell:ignore rica
  "GUATEMALA",
  "MEXICO",
  "PHILIPPINES",
  "BOLIVIA",
] as const;

type CountryCode = (typeof MantecaCountryCode)[number];

export const ExchangeByCountry: Record<CountryCode, (typeof Exchange)[number]> = {
  AR: "ARGENTINA",
  CL: "CHILE",
  BR: "BRAZIL",
  CO: "COLOMBIA",
  PA: "PANAMA",
  CR: "COSTA_RICA",
  GT: "GUATEMALA",
  MX: "MEXICO",
  PH: "PHILIPPINES",
  BO: "BOLIVIA",
};

// TODO replace with i8n lib
export const Nationality: Record<CountryCode, string> = {
  AR: "Argentina",
  CL: "Chile",
  BR: "Brasil",
  CO: "Colombia",
  PA: "Panamá", // cspell:ignore Panamá
  CR: "Costa Rica", // cspell:ignore Rica
  GT: "Guatemala",
  MX: "México", // cspell:ignore México
  PH: "Filipinas", // cspell:ignore Filipinas
  BO: "Bolivia",
};

export const MantecaCurrency = ["ARS", "USD", "BRL"] as const satisfies readonly (typeof Currency)[number][];

export const CurrenciesByExchange: Record<(typeof Exchange)[number], (typeof MantecaCurrency)[number][]> = {
  ARGENTINA: ["ARS", "USD"],
  CHILE: [],
  BRAZIL: ["BRL"],
  COLOMBIA: [],
  PANAMA: [],
  COSTA_RICA: [],
  GUATEMALA: [],
  MEXICO: [],
  PHILIPPINES: [],
  BOLIVIA: [],
};

export const NewUserResponse = object({
  user: object({
    id: string(),
    numberId: string(),
    externalId: optional(string()),
    sessionId: optional(string()),
    status: picklist(["ONBOARDING", "ACTIVE", "INACTIVE"]),
    type: picklist(["INDIVIDUAL", "BUSINESS"]),
    exchange: picklist(Exchange),
    onboarding: UserOnboardingTasks,
    creationTime: string(),
    updatedAt: string(),
  }),
});

export const UserStatus = ["ONBOARDING", "ACTIVE", "INACTIVE"] as const;
export const UserResponse = object({
  id: string(),
  numberId: string(),
  externalId: optional(string()),
  sessionId: optional(string()),
  status: picklist(UserStatus),
  type: picklist(["INDIVIDUAL", "BUSINESS"]),
  exchange: picklist(Exchange),
  onboarding: UserOnboardingTasks,
  creationTime: string(),
  updatedAt: string(),
});

export const UserOnboarding = object({
  externalId: optional(string()),
  email: string(),
  legalId: string(),
  type: picklist(["INDIVIDUAL", "BUSINESS"]),
  exchange: picklist(Exchange),
  personalData: object({
    name: string(),
    surname: string(),
    sex: picklist(["M", "F", "X"]),
    work: string(),
    birthDate: string(),
    isPep: boolean(),
    isFacta: boolean(),
    isFep: boolean(),
    phoneNumber: string(),
    nationality: string(),
    maritalStatus: picklist(["Soltero"]), // cspell:ignore Soltero
    address: optional(
      object({
        street: string(),
        postalCode: optional(string()),
        locality: optional(string()),
        province: optional(string()),
        floor: optional(string()),
        apartment: optional(string()),
      }),
    ),
  }),
});

export const UploadIdentityFile = object({
  userAnyId: string(),
  side: picklist(["FRONT", "BACK"]),
  fileName: string(),
});

export const UploadIdentityFileResponse = object({ url: string() });
// #endregion schemas

// #region utils
export async function pay(
  ramp: ReturnType<typeof manteca>,
  persona: Pick<ReturnType<typeof createPersona>, "getAccount">,
  credentialId: string,
  {
    userOpHash,
    sender,
    nonce,
    success,
    logs,
    refund,
    settlements,
  }: {
    logs: Log[];
    nonce: bigint;
    refund: boolean;
    sender: Address;
    settlements: Record<string, Address>;
    success: boolean;
    userOpHash: Hash;
  },
) {
  if (!success) return { code: ErrorCodes.INVALID_PAYMENT };
  const withdraws = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs }).filter(
    ({ address, args }) =>
      isAddressEqual(address, marketUSDCAddress) &&
      isAddressEqual(args.owner, sender) &&
      Object.values(settlements).some((settlement) => isAddressEqual(settlement, args.receiver)),
  );
  const paid = withdraws.reduce((total, { args }) => total + args.assets, 0n);
  const contexts = { payment: { account: sender, userOpHash, amount: String(paid) } };
  const code = decodeNonceKey(nonce);
  if (!code) {
    if (paid > 0n) captureException(new Error("usdc sent to settlement without qr lock"), { level: "error", contexts });
    return { code: ErrorCodes.INVALID_PAYMENT };
  }
  const lock = await ramp.getPaymentLock(code);
  if (!lock) {
    const synthetic = await ramp.getSynthetic(userOpHash);
    if (synthetic) return synthetic;
    if (paid > 0n) {
      captureException(new Error("qr payment not executed"), {
        level: refund ? "info" : "error",
        contexts: {
          payment: {
            ...contexts.payment,
            cause: lock === null ? "expired" : "lock",
            ...(refund && { refund: "automatic" }),
          },
        },
      });
    }
    return { code: lock === null ? ErrorCodes.EXPIRED_LOCK : ErrorCodes.INVALID_PAYMENT };
  }
  const personaAccount = await persona.getAccount(credentialId, "basic");
  const document = personaAccount?.attributes.fields.documents.value.find(
    ({ value }) => value.id_class.value === "id" && value.id_issuing_country.value === "AR",
  )?.value;
  if (!document || !lock.sender || legalId(document.id_number.value) !== legalId(lock.sender.legalId)) {
    if (paid > 0n) {
      captureException(new Error("qr payment not executed"), {
        level: refund ? "info" : "error",
        contexts: {
          payment: {
            ...contexts.payment,
            cause: "payer",
            persona: personaAccount?.id,
            ...(refund && { refund: "automatic" }),
          },
        },
      });
    }
    return { code: ErrorCodes.INVALID_PAYMENT };
  }
  const { [lock.paymentAsset]: receiver } = settlements;
  if (!receiver) throw new Error(ErrorCodes.NOT_SUPPORTED_CURRENCY);
  const assets = withdraws
    .filter(({ args }) => isAddressEqual(args.receiver, receiver))
    .reduce((total, { args }) => total + args.assets, 0n);
  if (assets * 100n < parseUnits(lock.paymentAgainstAmount, 8)) {
    if (paid > 0n) {
      captureException(new Error("qr payment not executed"), {
        level: refund ? "info" : "error",
        contexts: {
          payment: {
            ...contexts.payment,
            cause: "amount",
            assets: String(assets),
            lock: lock.paymentAgainstAmount,
            ...(refund && { refund: "automatic" }),
          },
        },
      });
    }
    return { code: ErrorCodes.INVALID_PAYMENT };
  }
  return await ramp.executeQRPayment(code, userOpHash);
}

export async function findOperation(hash: string | undefined) {
  if (!hash || !isHash(hash)) return;
  return await getUserOperationReceipt(publicClient, { hash }).catch((error: unknown) => {
    if (error instanceof UserOperationReceiptNotFoundError || error instanceof InvalidParamsRpcError) return;
    throw error;
  });
}

export function encodeNonceKey(code: string) {
  return concat([nonceKeyPrefix, `0x${parse(pipe(string(), uuid()), code).split("-").join("")}`]);
}

export function decodeNonceKey(nonce: bigint) {
  const key = numberToHex(nonce >> 64n, { size: 24 });
  if (!key.startsWith(nonceKeyPrefix)) return;
  const id = key.slice(nonceKeyPrefix.length);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function legalId(value: string) {
  return value.toLowerCase().replaceAll(/[.-]/g, "");
}

const nonceKeyPrefix = stringToHex("exa-qr\u0000\u0001");
// #endregion utils

export const ErrorCodes = {
  NOT_SUPPORTED_CHAIN_ID: "not supported chain id",
  NOT_SUPPORTED_CURRENCY: "not supported currency",
  MANTECA_USER_INACTIVE: "manteca user inactive",
  EXPIRED_LOCK: "expired lock",
  INVALID_AMOUNT: "invalid amount",
  INVALID_LEGAL_ID: "invalid legal id",
  INVALID_ORDER_SIZE: "invalid order size",
  INVALID_PAYMENT: "invalid payment",
  INVALID_QR: "invalid qr",
  NO_PERSONA_ACCOUNT: "no persona account",
  NO_DOCUMENT: "no document",
};

const MantecaApiErrorCodes = {
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  EXPIRED_LOCK: "EXPIRED_LOCK",
  INVALID_AMOUNT: "amount has wrong value",
  INVALID_LEGAL_ID: "legalId has wrong value",
  INVALID_ORDER_SIZE: "MIN_SIZE",
  INVALID_QR: "PAYMENT_DESTINATION",
  SYNTHETIC_EXISTS: "SYNTHETIC_EXISTS",
  SYNTHETIC_NOT_FOUND: "SYNTHETIC_NF",
  USER_NOT_FOUND: "USER_NF",
  WITHDRAW_EXISTS: "WITHDRAW_EXISTS",
  WITHDRAW_NOT_FOUND: "WITHDRAW_NF",
} as const;

type PersonaService = Pick<ReturnType<typeof createPersona>, "getAccount" | "getDocument" | "getDocumentForManteca">;
