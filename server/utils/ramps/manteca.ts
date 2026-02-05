import { captureException, captureMessage } from "@sentry/core";
import {
  array,
  boolean,
  number,
  object,
  optional,
  parse,
  picklist,
  safeParse,
  string,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";
import { withRetry } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import * as shared from "./shared";
import { getAccount, getDocument, getDocumentForManteca, MantecaCountryCode } from "../persona";

if (!process.env.MANTECA_API_URL) throw new Error("missing manteca api url");
const baseURL = process.env.MANTECA_API_URL;

if (!process.env.MANTECA_API_KEY) throw new Error("missing manteca api key");
const apiKey = process.env.MANTECA_API_KEY;

// #region services
export async function getUser(account: Address): Promise<InferInput<typeof UserResponse> | null> {
  const externalId = account.replace("0x", "");
  return await request(UserResponse, `/crypto/v2/users/${externalId}`).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes(MantecaApiErrorCodes.USER_NOT_FOUND)) return null;
    throw error;
  });
}

export async function initiateOnboarding(user: InferInput<typeof UserOnboarding>) {
  return await request(NewUserResponse, "/crypto/v2/onboarding-actions/initial", {}, user, "POST");
}

export async function uploadIdentityFile(
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
      );
      await forwardFileToURL(documentURL, presignedURL);
    },
    {
      delay: 1000,
      retryCount: 2,
      shouldRetry: ({ error }) => {
        captureException(error, { level: "warning" });
        return true;
      },
    },
  );
}

export async function acceptTermsAndConditions(userAnyId: string) {
  return await request(object({}), `/crypto/v2/onboarding-actions/accept-tyc`, {}, { userAnyId }, "POST");
}

export async function balances(userAnyId: string) {
  return await request(BalancesResponse, `/crypto/v2/user-balances/${userAnyId}`, {}, undefined, "GET");
}

export async function getQuote(coinPair: string): Promise<InferOutput<typeof shared.QuoteResponse> | undefined> {
  const quote = await request(QuoteResponse, `/crypto/v2/prices/direct/${coinPair}`, {}, undefined, "GET").catch(
    (error: unknown) => {
      captureException(error, { level: "error" });
    },
  );
  if (!quote) return;
  return { buyRate: quote.buy, sellRate: quote.sell };
}

export async function lockPrice(side: "BUY" | "SELL", asset: string, against: string, userAnyId: string) {
  return await request(PriceLockResponse, `/crypto/v2/price-locks`, {}, { side, asset, against, userAnyId }, "POST");
}

export async function createOnRampSynthetic(order: InferInput<typeof OnRampSynthetic>) {
  return await request(OnRampSyntheticResponse, "/crypto/v2/synthetics/ramp-on", {}, order, "POST");
}

export async function getSynthetic(syntheticId: string) {
  return await request(OnRampSyntheticResponse, `/crypto/v2/synthetics/${syntheticId}`, {}, undefined, "GET");
}

export async function getLimits(userNumberId: string) {
  return await request(LimitsResponse, `/crypto/v2/limits/${userNumberId}`, {}, undefined, "GET");
}

export async function createOrder(order: InferInput<typeof Order>) {
  return await request(OrderResponse, "/crypto/v2/orders", {}, order, "POST");
}

export async function withdrawOrder(withdraw: InferInput<typeof Withdraw>) {
  return await request(WithdrawResponse, "/crypto/v2/withdraws", {}, withdraw, "POST");
}

export async function lockQrPayment(userAnyId: string, paymentDestination: string, amount?: string, against?: string) {
  return await request(
    QrPaymentResponse,
    "/crypto/v2/payment-locks",
    {},
    { userAnyId, paymentDestination, amount, against },
    "POST",
  );
}

export function getDepositDetails(
  currency: (typeof MantecaCurrency)[number],
  exchange: (typeof Exchange)[number],
): InferOutput<typeof shared.DepositDetails>[] {
  const network: `${(typeof MantecaCurrency)[number]}-${(typeof Exchange)[number]}` = `${currency}-${exchange}`;
  switch (network) {
    case "ARS-ARGENTINA":
      return [
        {
          depositAlias: "exa.ars",
          cbu: "0000234100000000000529",
          network: "ARG_FIAT_TRANSFER",
          fee: "0.0",
          estimatedProcessingTime: "300",
          displayName: "CVU",
          beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
        } as const,
      ];
    case "USD-ARGENTINA":
      return [
        {
          cbu: "4310009942700000065019",
          network: "ARG_FIAT_TRANSFER",
          fee: "0.0",
          estimatedProcessingTime: "300",
          displayName: "CBU",
          beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
        } as const,
      ];
    case "BRL-BRAZIL":
      return [
        {
          pixKey: "100d6f24-c507-43a1-935c-ba3fb9d1c16d", // gitleaks:allow public PIX deposit key; not a credential
          network: "PIX",
          fee: "0.0",
          estimatedProcessingTime: "300",
          displayName: "PIX KEY",
          beneficiaryName: "JUST PAGAMENTOS LTDA", // cspell:ignore PAGAMENTOS LTDA
        } as const,
      ];
    default:
      captureMessage(`${network} not supported`);
      throw new Error(ErrorCodes.NOT_SUPPORTED_CURRENCY);
  }
}

export async function convertBalanceToUsdc(userNumberId: string, against: string) {
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
    if (error instanceof Error && error.message.includes(MantecaApiErrorCodes.INVALID_ORDER_SIZE)) {
      throw new Error(ErrorCodes.INVALID_ORDER_SIZE);
    }
    throw error;
  });
}

export async function withdrawBalance(userNumberId: string, asset: string, address: Address) {
  const userBalances = await balances(userNumberId);
  const assetBalance = userBalances.balance[asset as keyof typeof userBalances.balance];
  if (!assetBalance) throw new Error("asset balance not found");

  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("manteca_not_supported_chain_id", { level: "error", contexts: { chain } });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  await withdrawOrder({
    userAnyId: userNumberId,
    asset,
    amount: assetBalance,
    destination: { address, network: supportedChainId },
  });
}

export async function getProvider(
  account: Address,
  countryCode?: string,
): Promise<InferOutput<typeof shared.ProviderInfo>> {
  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("manteca_not_supported_chain_id", { level: "error", contexts: { chain } });
    return { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" };
  }

  const currencies = getSupportedByCountry(countryCode);
  const mantecaUser = await getUser(account);
  if (!mantecaUser) {
    return { onramp: { currencies, cryptoCurrencies: [] }, status: "NOT_STARTED" };
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
        cryptoCurrencies: [],
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
      status: "ACTIVE",
    };
  }
  if (mantecaUser.status === "INACTIVE") {
    return { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" };
  }
  const hasPendingTasks = Object.values(mantecaUser.onboarding).some(
    (task) => task.required && task.status === "PENDING",
  );
  if (hasPendingTasks) {
    captureException(new Error("has pending tasks"), { level: "warning", contexts: { mantecaUser } });
    return { onramp: { currencies, cryptoCurrencies: [] }, status: "NOT_STARTED" };
  }
  return { onramp: { currencies, cryptoCurrencies: [] }, status: "ONBOARDING" };
}

export async function mantecaOnboarding(account: Address, credentialId: string) {
  const externalId = account.replace("0x", "");
  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("manteca_not_supported_chain_id", { level: "error", contexts: { chain } });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  const mantecaUser = await getUser(account);
  if (mantecaUser?.status === "ACTIVE") return;
  if (mantecaUser?.status === "INACTIVE") throw new Error(ErrorCodes.MANTECA_USER_INACTIVE);
  const personaAccount = await getAccount(credentialId, "manteca");
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);
  const countryCode = personaAccount.attributes["country-code"];

  const identityDocument = await getDocumentForManteca(personaAccount.attributes.fields.documents.value, countryCode);
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
    });
  }

  const document = await getDocument(identityDocument.id_document_id.value);
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
// #endregion services

// #region schemas
const Networks = ["OPTIMISM", "BASE"] as const;

const SupportedOnRampChainId: Record<(typeof shared.SupportedChainId)[number], (typeof Networks)[number] | undefined> =
  {
    [optimism.id]: "OPTIMISM",
    [base.id]: "BASE",
    [baseSepolia.id]: "BASE",
    [optimismSepolia.id]: "OPTIMISM",
  } as const;

export const WithdrawStatus = ["PENDING", "EXECUTED", "CANCELLED"] as const;
export const Withdraw = object({
  userAnyId: string(),
  asset: string(),
  amount: string(),
  destination: object({ address: Address, network: picklist(Networks) }),
});

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

export const OnRampSyntheticResponse = object({
  id: string(),
  numberId: string(),
  userNumberId: string(),
  status: picklist(["STARTING", "ACTIVE", "WAITING", "PAUSED", "COMPLETED", "CANCELLED"]),
  details: object({
    depositAddress: string(),
    depositAlias: string(),
    withdrawCostInAgainst: string(),
    withdrawCostInAsset: string(),
    price: string(),
    priceExpireAt: string(),
  }),
  currentStage: number(),
  stages: object({
    1: object({
      stageType: picklist(["DEPOSIT"]),
      asset: string(),
      thresholdAmount: string(),
      useOverflow: boolean(),
      expireAt: string(),
    }),
    2: object({
      stageType: picklist(["ORDER"]),
      side: picklist(["BUY", "SELL"]),
      type: picklist(["MARKET"]),
      asset: string(),
      against: string(),
      assetAmount: string(),
      price: string(),
      priceCode: string(),
      disallowDebt: boolean(),
    }),
    3: object({
      stageType: picklist(["WITHDRAW"]),
      network: picklist(["ETHEREUM", "BINANCE", "POLYGON", "OPTIMISM", "INTERNAL"]),
      asset: string(),
      amount: string(),
      to: Address,
      destination: object({
        address: Address,
        network: picklist(["ETHEREUM", "BINANCE", "POLYGON", "OPTIMISM", "INTERNAL"]),
      }),
    }),
  }),
  creationTime: string(),
  updatedAt: string(),
});

export const PriceLockResponse = object({
  code: string(),
  userId: string(),
  userNumberId: string(),
  userExternalId: optional(string()),
  side: picklist(["BUY", "SELL"]),
  asset: string(),
  against: string(),
  price: string(),
});

export const QrPaymentResponse = object({
  code: optional(string()),
  type: string(),
  companyId: string(),
  userId: string(),
  userNumberId: string(),
  userExternalId: optional(string()),
  paymentRecipientName: optional(string()),
  paymentRecipientLegalId: optional(string()),
  paymentAssetAmount: string(),
  paymentAsset: string(),
  paymentPrice: optional(string()),
  paymentAgainstAmount: string(),
  expireAt: string(),
  creationTime: string(),
});

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
  updatedAt: string(),
});

const onboardingTaskStatus = ["PENDING", "COMPLETED", "IN_PROGRESS"] as const;
const OnboardingTaskInfo = optional(
  object({
    required: boolean(),
    status: picklist(onboardingTaskStatus),
    rejectionReason: optional(string()),
  }),
);
const UserOnboardingTasks = object({
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

export const MantecaCurrency = [
  "ARS",
  "USD",
  "BRL",
  "CLP",
  "COP",
  "PUSD",
  "CRC",
  "GTQ",
  "MXN",
  "PHP",
  "BOB",
] as const satisfies readonly (typeof shared.Currency)[number][];

export const CurrenciesByExchange: Record<(typeof Exchange)[number], (typeof MantecaCurrency)[number][]> = {
  ARGENTINA: ["ARS", "USD"],
  CHILE: ["CLP"],
  BRAZIL: ["BRL"],
  COLOMBIA: ["COP"],
  PANAMA: ["PUSD"],
  COSTA_RICA: ["CRC"],
  GUATEMALA: ["GTQ"],
  MEXICO: ["MXN"],
  PHILIPPINES: ["PHP"],
  BOLIVIA: ["BOB"],
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
async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: {
      ...headers,
      "md-api-key": apiKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new Error(`::${response.status}:: ${await response.text()}`);
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return parse(schema, {});
  return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}

function isDevelopment(): boolean {
  return shared.DevelopmentChainIds.includes(chain.id as (typeof shared.DevelopmentChainIds)[number]);
}

function getSupportedByCountry(countryCode?: string): (typeof MantecaCurrency)[number][] {
  if (!countryCode) return [];
  if (isDevelopment()) return CurrenciesByExchange.ARGENTINA;
  const result = safeParse(picklist(MantecaCountryCode), countryCode);
  if (!result.success) return [];
  return CurrenciesByExchange[ExchangeByCountry[result.output]];
}

function getExchange(countryCode: string): (typeof Exchange)[number] {
  if (isDevelopment()) return "ARGENTINA";
  const result = safeParse(picklist(MantecaCountryCode), countryCode);
  if (!result.success) throw new Error(`Invalid country: ${countryCode}`);
  return ExchangeByCountry[result.output];
}

function getNationality(countryCode: string): string {
  if (isDevelopment()) return "Argentina";
  const result = safeParse(picklist(MantecaCountryCode), countryCode);
  if (!result.success) throw new Error(`Invalid country: ${countryCode}`);
  return Nationality[result.output];
}

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

// #endregion utils

export const ErrorCodes = {
  NOT_SUPPORTED_CHAIN_ID: "not supported chain id",
  NOT_SUPPORTED_CURRENCY: "not supported currency",
  MANTECA_USER_INACTIVE: "manteca user inactive",
  INVALID_ORDER_SIZE: "invalid order size",
  NO_PERSONA_ACCOUNT: "no persona account",
  NO_DOCUMENT: "no document",
};

const MantecaApiErrorCodes = {
  INVALID_ORDER_SIZE: "MIN_SIZE",
  USER_NOT_FOUND: "USER_NF",
} as const;
