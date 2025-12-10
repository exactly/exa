import { captureException, captureMessage } from "@sentry/core";
import {
  array,
  boolean,
  literal,
  number,
  object,
  optional,
  parse,
  picklist,
  string,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import {
  getAccount,
  getInquiry,
  resumeOrCreateMantecaInquiryOTL,
  type MantecaCountryCode as CountryCode,
  type IdentificationClasses,
  type Inquiry,
} from "../persona";

import type * as shared from "./shared";

if (!process.env.MANTECA_API_URL) throw new Error("missing manteca api url");
const baseURL = process.env.MANTECA_API_URL;

if (!process.env.MANTECA_API_KEY) throw new Error("missing manteca api key");
const apiKey = process.env.MANTECA_API_KEY;

// #region services
export async function getUser(userId: string): Promise<InferInput<typeof UserResponse> | null> {
  return await request(UserResponse, `/crypto/v2/users/${userId}`).catch((error: unknown) => {
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
  const { url: presignedURL } = await request(
    UploadIdentityFileResponse,
    "/crypto/v2/onboarding-actions/upload-identity-image",
    {},
    {
      userAnyId,
      fileName,
      side,
    },
    "POST",
  );
  await forwardFileToURL(documentURL, presignedURL);
}

export async function acceptTermsAndConditions(userAnyId: string) {
  return await request(object({}), `/crypto/v2/onboarding-actions/accept-tyc`, {}, { userAnyId }, "POST");
}

export async function balances(userAnyId: string) {
  return await request(BalancesResponse, `/crypto/v2/user-balances/${userAnyId}`, {}, undefined, "GET");
}

export async function getQuote(coinPair: string): Promise<InferOutput<typeof shared.QuoteResponse>> {
  const quote = await request(QuoteResponse, `/crypto/v2/prices/direct/${coinPair}`, {}, undefined, "GET").catch(
    (error: unknown) => {
      captureException(error);
    },
  );
  if (!quote) return;
  return {
    buyRate: quote.buy,
    sellRate: quote.sell,
  };
}

export async function lockPrice(side: "BUY" | "SELL", asset: string, against: string, userAnyId: string) {
  return await request(
    PriceLockResponse,
    `/crypto/v2/price-locks`,
    {},
    {
      side,
      asset,
      against,
      userAnyId,
    },
    "POST",
  );
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
          pixKey: "100d6f24-c507-43a1-935c-ba3fb9d1c16d",
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

export async function withdrawBalance(userNumberId: string, asset: string, address: string) {
  const userBalances = await balances(userNumberId);
  const assetBalance = userBalances.balance[asset as keyof typeof userBalances.balance];
  if (!assetBalance) throw new Error("asset balance not found");

  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("manteca_not_supported_chain_id", { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  await withdrawOrder({
    userAnyId: userNumberId,
    asset,
    amount: assetBalance,
    destination: {
      address,
      network: supportedChainId,
    },
  });
}

export async function getProvider(
  account: string,
  credentialId: string,
  templateId: string,
  countryCode?: string,
  redirectURL?: string,
): Promise<{
  cryptoCurrencies: {
    cryptoCurrency: (typeof shared.Cryptocurrency)[number];
    network: (typeof shared.CryptoNetwork)[number];
  }[];
  currencies: string[];
  pendingTasks: InferOutput<typeof shared.PendingTask>[];
  status: "ACTIVE" | "MISSING_INFORMATION" | "NOT_AVAILABLE" | "NOT_STARTED" | "ONBOARDING";
}> {
  const allowedCountry = countryCode && allowedCountries.get(countryCode as (typeof CountryCode)[number]);
  if (countryCode && !allowedCountry) {
    return { status: "NOT_AVAILABLE", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
  }

  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("manteca_not_supported_chain_id", { contexts: { chain }, level: "error" });
    return { status: "NOT_AVAILABLE", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
  }

  const currencies = getSupportedByCountry(countryCode);
  const mantecaUser = await getUser(account.replace("0x", ""));
  if (!mantecaUser) {
    const [inquiry, personaAccount] = await Promise.all([
      getInquiry(credentialId, templateId),
      getAccount(credentialId, "manteca"),
    ]);
    if (!inquiry || !personaAccount) throw new Error(ErrorCodes.NO_KYC);
    if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
      throw new Error(ErrorCodes.KYC_NOT_APPROVED);
    }

    const country = personaAccount.attributes["country-code"];

    try {
      validateIdentification(inquiry);
    } catch (error) {
      if (error instanceof Error && Object.values(ErrorCodes).includes(error.message)) {
        switch (error.message) {
          case ErrorCodes.COUNTRY_NOT_ALLOWED:
          case ErrorCodes.ID_NOT_ALLOWED:
            return { status: "NOT_AVAILABLE", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
          case ErrorCodes.BAD_KYC_ADDITIONAL_DATA: {
            let mantecaRedirectURL: undefined | URL = undefined;
            if (redirectURL) {
              mantecaRedirectURL = new URL(redirectURL);
              mantecaRedirectURL.searchParams.set("provider", "manteca" satisfies (typeof shared.RampProvider)[number]);
            }
            const inquiryTask: InferOutput<typeof shared.PendingTask> = {
              type: "INQUIRY",
              link: await resumeOrCreateMantecaInquiryOTL(credentialId, mantecaRedirectURL?.toString()),
              displayText: "We need more information to complete your KYC",
              currencies: getSupportedByCountry(country),
              cryptoCurrencies: [],
            };
            return { status: "MISSING_INFORMATION", currencies, cryptoCurrencies: [], pendingTasks: [inquiryTask] };
          }
        }
        captureException(error, { contexts: { inquiry } });
      }
      throw error;
    }
    return { status: "NOT_STARTED", currencies, cryptoCurrencies: [], pendingTasks: [] };
  }
  if (mantecaUser.status === "ACTIVE") {
    const exchange = mantecaUser.exchange;
    return { status: "ACTIVE", currencies: CurrenciesByExchange[exchange], cryptoCurrencies: [], pendingTasks: [] };
  }
  if (mantecaUser.status === "INACTIVE") {
    return { status: "NOT_AVAILABLE", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
  }
  const hasPendingTasks = Object.values(mantecaUser.onboarding).some(
    (task) => task.required && task.status === "PENDING",
  );
  if (hasPendingTasks) {
    captureException(new Error("has pending tasks"), { contexts: { mantecaUser } });
    return { status: "ONBOARDING", currencies, cryptoCurrencies: [], pendingTasks: [] };
  }
  return { status: "ONBOARDING", currencies, cryptoCurrencies: [], pendingTasks: [] };
}

export async function mantecaOnboarding(_account: string, _credentialId: string, _templateId: string) {
  await Promise.reject(new Error("not implemented"));
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

export const MantecaOnboarding = object({
  gender: picklist(["Male", "Female", "Prefer not to say"]),
  isnotfacta: literal(true), // cspell:ignore isnotfacta
  tin: string(),
  termsAccepted: boolean(),
});

export const WithdrawStatus = ["PENDING", "EXECUTED", "CANCELLED"] as const;
export const Withdraw = object({
  userAnyId: string(),
  asset: string(),
  amount: string(),
  destination: object({
    address: Address,
    network: picklist(Networks),
  }),
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

export const QuoteResponse = object({
  ticker: string(),
  timestamp: string(),
  buy: string(),
  sell: string(),
});

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

const onboardingTaskStatus = ["PENDING", "COMPLETED"] as const;
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

export const ExchangeByCountry: Record<(typeof CountryCode)[number], (typeof Exchange)[number]> = {
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

  // TODO for testing, remove
  US: "ARGENTINA",
};

// TODO replace with i8n lib
export const Nationality: Record<(typeof CountryCode)[number], string> = {
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

  // TODO for testing, remove
  US: "Argentina",
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

export const allowedCountries = new Map<
  (typeof CountryCode)[number],
  { allowedIds: (typeof IdentificationClasses)[number][] }
>([
  ["AR", { allowedIds: ["id", "pp"] }],
  ["BR", { allowedIds: ["id", "dl", "pp"] }],
  // ["CL", { allowedIds: [] }],
  // ["CO", { allowedIds: ["id", "dl", "pp"] }],
  // ["PA", { allowedIds: [] }],
  // ["CR", { allowedIds: [] }],
  // ["GT", { allowedIds: [] }],
  // ["MX", { allowedIds: [] }],
  // ["PH", { allowedIds: [] }],
  // ["BO", { allowedIds: [] }],

  // TODO for testing, remove
  ["US", { allowedIds: ["dl"] }],
]);

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
  person: optional(
    object({
      legalId: optional(string()),
      email: optional(string()),
      flags: object({
        isDead: boolean(),
        isPEP: boolean(),
        isFACTA: boolean(),
        isFEP: boolean(),
      }),
      personalData: optional(
        object({
          name: optional(string()),
          surname: optional(string()),
          sex: optional(string()),
          work: optional(string()),
          birthDate: optional(string()),
          phoneNumber: optional(string()),
          nationality: optional(string()),
          maritalStatus: optional(string()),
          cleanName: optional(string()),
          address: optional(
            object({
              postalCode: optional(string()),
              locality: optional(string()),
              province: optional(string()),
              street: optional(string()),
              floor: optional(string()),
              numeration: optional(string()),
            }),
          ),
          document: optional(
            object({
              type: optional(string()),
              id: optional(string()),
            }),
          ),
        }),
      ),
    }),
  ),
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

export const UploadIdentityFileResponse = object({
  url: string(),
});
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

export function validateIdentification(_inquiry: InferOutput<typeof Inquiry>) {
  throw new Error("not implemented");
}

function getSupportedByCountry(countryCode?: string): (typeof MantecaCurrency)[number][] {
  if (!countryCode) return [];
  const exchange = ExchangeByCountry[countryCode as (typeof CountryCode)[number]];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!exchange) return [];
  return CurrenciesByExchange[exchange];
}

async function forwardFileToURL(sourceURL: string, destinationURL: string): Promise<void> {
  const abort = new AbortController();
  const timeout = setTimeout(() => {
    abort.abort();
  }, 10_000);

  try {
    const source = await fetch(sourceURL, {
      headers: { "accept-encoding": "identity" },
      signal: abort.signal,
    });
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
      const errorText = await safeText(destination);
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

async function safeText(response: Response): Promise<string> {
  return await response.text().catch(() => "no error text");
}

// #endregion utils

export const ErrorCodes = {
  MULTIPLE_IDENTIFICATION_NUMBERS: "multiple identification numbers",
  NO_IDENTIFICATION_NUMBER: "no identification number",
  NO_IDENTIFICATION_CLASS: "no identification class",
  BAD_KYC_ADDITIONAL_DATA: "bad kyc additional data",
  NOT_SUPPORTED_CURRENCY: "not supported currency",
  NOT_SUPPORTED_CHAIN_ID: "not supported chain id",
  MANTECA_USER_INACTIVE: "manteca user inactive",
  COUNTRY_NOT_ALLOWED: "country not allowed",
  MULTIPLE_DOCUMENTS: "multiple documents",
  NO_PERSONA_ACCOUNT: "no persona account",
  INVALID_ORDER_SIZE: "invalid order size",
  KYC_NOT_APPROVED: "kyc not approved",
  BAD_MANTECA_KYC: "bad manteca kyc",
  ID_NOT_ALLOWED: "id not allowed",
  NO_NON_FACTA: "no non facta",
  NO_DOCUMENT: "no document",
  NO_GENDER: "no gender",
  NO_KYC: "no kyc",
};

const MantecaApiErrorCodes = {
  INVALID_ORDER_SIZE: "MIN_SIZE",
  USER_NOT_FOUND: "USER_NF",
} as const;
