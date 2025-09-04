import { Address } from "@exactly/common/validation";
import { captureException } from "@sentry/core";
import * as v from "valibot";

import { getAccount, getDocument, getInquiry, type Account, type Inquiry } from "../persona";
import type { Currency, DepositDetails } from "./shared";

if (!process.env.MANTECA_API_URL) throw new Error("missing manteca api url");
const baseURL = process.env.MANTECA_API_URL;

if (!process.env.MANTECA_API_KEY) throw new Error("missing manteca api key");
const apiKey = process.env.MANTECA_API_KEY;

export const ErrorCodes = {
  MULTIPLE_IDENTIFICATION_NUMBERS: "multiple identification numbers",
  NO_IDENTIFICATION_NUMBER: "no identification number",
  BAD_KYC_ADDITIONAL_DATA: "bad kyc additional data",
  MANTECA_USER_INACTIVE: "manteca user inactive",
  COUNTRY_NOT_ALLOWED: "country not allowed",
  MULTIPLE_DOCUMENTS: "multiple documents",
  NO_PERSONA_ACCOUNT: "no persona account",
  KYC_NOT_APPROVED: "kyc not approved",
  BAD_MANTECA_KYC: "bad manteca kyc",
  ID_NOT_ALLOWED: "id not allowed",
  NO_NON_FACTA: "no non facta",
  NO_DOCUMENT: "no document",
  NO_GENDER: "no gender",
  NO_KYC: "no kyc",
};

const MantecaApiErrorCodes = {
  USER_NOT_FOUND: "USER_NF",
} as const;

// #region services
export async function getUser(userId: string): Promise<v.InferInput<typeof UserResponse> | null> {
  return await request(UserResponse, `/crypto/v2/users/${userId}`).catch((error: unknown) => {
    if (error instanceof Error && error.message.includes(MantecaApiErrorCodes.USER_NOT_FOUND)) return null;
    throw error;
  });
}

export async function initiateOnboarding(user: v.InferInput<typeof UserOnboarding>) {
  return await request(NewUserResponse, `/crypto/v2/onboarding-actions/initial`, {}, user, "POST");
}

export async function uploadIdentityFile(
  userAnyId: string,
  side: "FRONT" | "BACK",
  fileName: string,
  documentURL?: string | null,
): Promise<void> {
  if (!documentURL) return;
  const { url: presignedURL } = await request(
    UploadIdentityFileResponse,
    `/crypto/v2/onboarding-actions/upload-identity-image`,
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
  return await request(v.object({}), `/crypto/v2/onboarding-actions/accept-tyc`, {}, { userAnyId }, "POST");
}

export async function balances(userAnyId: string) {
  return await request(BalancesResponse, `/crypto/v2/user-balances/${userAnyId}`, {}, undefined, "GET");
}

export async function getQuote(coinPair: string) {
  return await request(QuoteResponse, `/crypto/v2/prices/direct/${coinPair}`, {}, undefined, "GET");
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

export async function createOnRampSynthetic(order: v.InferInput<typeof OnRampSynthetic>) {
  return await request(OnRampSyntheticResponse, `/crypto/v2/synthetics/ramp-on`, {}, order, "POST");
}

export async function getSynthetic(syntheticId: string) {
  return await request(OnRampSyntheticResponse, `/crypto/v2/synthetics/${syntheticId}`, {}, undefined, "GET");
}

export async function getLimits(userNumberId: string) {
  return await request(LimitsResponse, `/crypto/v2/limits/${userNumberId}`, {}, undefined, "GET");
}

export async function createOrder(order: v.InferInput<typeof Order>) {
  return await request(OrderResponse, `/crypto/v2/orders`, {}, order, "POST");
}

export async function withdrawOrder(withdraw: v.InferInput<typeof Withdraw>) {
  return await request(WithdrawResponse, `/crypto/v2/withdraws  `, {}, withdraw, "POST");
}

export function getDepositDetails(
  currency: (typeof MantecaCurrency)[number],
  exchange: (typeof Exchange)[number],
): v.InferOutput<typeof DepositDetails> {
  const network: `${(typeof MantecaCurrency)[number]}-${(typeof Exchange)[number]}` = `${currency}-${exchange}`;
  switch (network) {
    case "ARS-ARGENTINA":
      return {
        depositAlias: "exa.ars",
        depositAddress: "0000234100000000000529",
        network: "ARG_FIAT_TRANSFER",
        fee: "0.0",
        estimatedProcessingTime: "300",
        displayName: "CVU",
        beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
      } as const;
    case "USD-ARGENTINA":
      return {
        depositAddress: "4310009942700000065019",
        network: "ARG_FIAT_TRANSFER",
        fee: "0.0",
        estimatedProcessingTime: "300",
        displayName: "CBU",
        beneficiaryName: "Sixalime Sas", // cspell:ignore Sixalime
      } as const;
    case "BRL-BRAZIL":
      return {
        depositAddress: "100d6f24-c507-43a1-935c-ba3fb9d1c16d",
        network: "PIX",
        fee: "0.0",
        estimatedProcessingTime: "300",
        displayName: "PIX KEY",
        beneficiaryName: "JUST PAGAMENTOS LTDA", // cspell:ignore PAGAMENTOS LTDA
      } as const;
    default:
      throw new Error(`${network} not supported`);
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
  });
}

export async function withdrawBalance(userNumberId: string, asset: string, address: string) {
  const userBalances = await balances(userNumberId);
  const assetBalance = userBalances.balance[asset as keyof typeof userBalances.balance];
  if (!assetBalance) throw new Error("asset balance not found");

  await withdrawOrder({
    userAnyId: userNumberId,
    asset,
    amount: assetBalance,
    destination: {
      address,
      network: "OPTIMISM",
    },
  });
}

export async function getProvider(
  account: string,
  credentialId: string,
  templateId: string,
  countryCode?: string,
): Promise<{
  status: "NOT_STARTED" | "ACTIVE" | "ONBOARDING" | "NOT_AVAILABLE" | "MISSING_INFORMATION";
  currencies: string[];
}> {
  const allowedCountry = countryCode && allowedCountries.get(countryCode as (typeof CountryCode)[number]);
  if (countryCode && !allowedCountry) return { status: "NOT_AVAILABLE", currencies: [] };
  const currencies = getSupportedByCountry(countryCode);
  const mantecaUser = await getUser(account.replace("0x", ""));
  if (!mantecaUser) {
    const [inquiry, personaAccount] = await Promise.all([
      getInquiry(credentialId, templateId),
      getAccount(credentialId),
    ]);
    if (!inquiry || !personaAccount) throw new Error(ErrorCodes.NO_KYC);
    if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
      throw new Error(ErrorCodes.KYC_NOT_APPROVED);
    }

    try {
      validatePersonaAccount(personaAccount);
    } catch (error) {
      captureException(error, { contexts: { inquiry } });
      if (error instanceof Error && Object.values(ErrorCodes).includes(error.message)) {
        switch (error.message) {
          case ErrorCodes.COUNTRY_NOT_ALLOWED:
          case ErrorCodes.ID_NOT_ALLOWED:
            return { status: "NOT_AVAILABLE", currencies: [] };
          case ErrorCodes.BAD_KYC_ADDITIONAL_DATA:
            return { status: "MISSING_INFORMATION", currencies };
        }
      }
      throw error;
    }
    return { status: "NOT_STARTED", currencies };
  }
  if (mantecaUser.status === "ACTIVE") {
    const exchange = mantecaUser.exchange;
    return { status: "ACTIVE", currencies: CurrenciesByExchange[exchange] };
  }
  if (mantecaUser.status === "INACTIVE") return { status: "NOT_AVAILABLE", currencies: [] };
  const hasPendingTasks = Object.values(mantecaUser.onboarding).some(
    (task) => task.required && task.status === "PENDING",
  );
  if (hasPendingTasks) {
    captureException(new Error("has pending tasks"), { contexts: { mantecaUser } });
    return { status: "NOT_STARTED", currencies };
  }
  return { status: "ONBOARDING", currencies };
}

export async function mantecaOnboarding(account: string, credentialId: string, templateId: string) {
  const inquiry = await getInquiry(credentialId, templateId);
  if (!inquiry) throw new Error(ErrorCodes.NO_KYC);
  if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
    throw new Error(ErrorCodes.KYC_NOT_APPROVED);
  }
  const mantecaUser = await getUser(account.replace("0x", ""));
  if (mantecaUser?.status === "ACTIVE") return;
  if (mantecaUser?.status === "INACTIVE") throw new Error(ErrorCodes.MANTECA_USER_INACTIVE);

  if (!mantecaUser) {
    const work = inquiry.attributes.fields["input-select"]?.value;
    if (!work) throw new Error("no work value");

    const personaAccount = await getAccount(credentialId);
    if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);
    const additionalData = v.safeParse(MantecaOnboarding, {
      tin: personaAccount.attributes.fields.tin?.value,
      gender: personaAccount.attributes.fields.gender?.value,
      isnotfacta: personaAccount.attributes.fields.isnotfacta?.value, // cspell:ignore isnotfacta
    });
    if (!additionalData.success) {
      captureException(new Error(ErrorCodes.BAD_KYC_ADDITIONAL_DATA), { contexts: { personaAccount } });
      throw new Error(ErrorCodes.BAD_KYC_ADDITIONAL_DATA);
    }

    await initiateOnboarding({
      email: inquiry.attributes["email-address"],
      legalId: additionalData.output.tin,
      externalId: account.replace("0x", ""),
      type: "INDIVIDUAL",
      exchange: getExchange(personaAccount.attributes["country-code"]),
      personalData: {
        birthDate: inquiry.attributes.birthdate,
        nationality: getNationality(personaAccount.attributes["country-code"]),
        phoneNumber: inquiry.attributes["phone-number"],
        surname: inquiry.attributes["name-last"],
        name: inquiry.attributes["name-first"],
        maritalStatus: "Soltero", // cspell:ignore soltero
        sex: additionalData.output.gender === "Male" ? "M" : additionalData.output.gender === "Female" ? "F" : "X",
        isFacta: !additionalData.output.isnotfacta,
        isPep: false,
        isFep: false,
        work,
      },
    });
  }

  const documentId = getDocumentId(inquiry);
  const identityDocument = await getDocument(documentId);
  const frontDocumentURL = identityDocument.attributes["front-photo"]?.url;
  const backDocumentURL = identityDocument.attributes["back-photo"]?.url;

  const results = await Promise.allSettled([
    uploadIdentityFile(
      account.replace("0x", ""),
      "FRONT",
      identityDocument.attributes["front-photo"]?.filename ?? "front-photo.jpg",
      frontDocumentURL,
    ),
    uploadIdentityFile(
      account.replace("0x", ""),
      "BACK",
      identityDocument.attributes["back-photo"]?.filename ?? "back-photo.jpg",
      backDocumentURL,
    ),
    acceptTermsAndConditions(account.replace("0x", "")),
  ]);

  for (const result of results) {
    result.status === "rejected" && captureException(result.reason, { extra: { account } });
  }
}
// #endregion services

// #region schemas
export const MantecaOnboarding = v.object({
  gender: v.picklist(["Male", "Female", "Prefer not to say"]),
  isnotfacta: v.literal(true),
  // TODO review regex
  tin: v.string(),
});

export const WithdrawStatus = ["PENDING", "EXECUTED", "CANCELLED"] as const;
export const Withdraw = v.object({
  userAnyId: v.string(),
  asset: v.string(),
  amount: v.string(),
  destination: v.object({
    address: Address,
    network: v.picklist(["OPTIMISM"]),
  }),
});

export const WithdrawResponse = v.object({
  id: v.string(),
  numberId: v.string(),
  userExternalId: v.optional(v.string()),
  status: v.picklist(WithdrawStatus),
});

export const Order = v.object({
  externalId: v.optional(v.string()),
  userAnyId: v.string(),
  side: v.picklist(["BUY", "SELL"]),
  asset: v.string(),
  against: v.string(),
  againstAmount: v.string(),
  disallowDebt: v.boolean(),
});

export const OrderStatus = ["PENDING", "COMPLETED", "CANCELLED"] as const;
export const OrderResponse = v.object({
  id: v.string(),
  numberId: v.string(),
  userExternalId: v.optional(v.string()),
  status: v.picklist(OrderStatus),
});

export const OnRampSynthetic = v.object({
  userAnyId: v.string(),
  asset: v.string(),
  against: v.string(),
  againstAmount: v.string(),
  priceCode: v.optional(v.string()),
  disallowDebt: v.boolean(),
  destination: v.object({
    address: Address,
    network: v.picklist(["ETHEREUM", "BINANCE", "POLYGON", "OPTIMISM", "INTERNAL"]),
  }),
});

export const OnRampSyntheticResponse = v.object({
  id: v.string(),
  numberId: v.string(),
  userNumberId: v.string(),
  status: v.picklist(["STARTING", "ACTIVE", "WAITING", "PAUSED", "COMPLETED", "CANCELLED"]),
  details: v.object({
    depositAddress: v.string(),
    depositAlias: v.string(),
    withdrawCostInAgainst: v.string(),
    withdrawCostInAsset: v.string(),
    price: v.string(),
    priceExpireAt: v.string(),
  }),
  currentStage: v.number(),
  stages: v.object({
    1: v.object({
      stageType: v.picklist(["DEPOSIT"]),
      asset: v.string(),
      thresholdAmount: v.string(),
      useOverflow: v.boolean(),
      expireAt: v.string(),
    }),
    2: v.object({
      stageType: v.picklist(["ORDER"]),
      side: v.picklist(["BUY", "SELL"]),
      type: v.picklist(["MARKET"]),
      asset: v.string(),
      against: v.string(),
      assetAmount: v.string(),
      price: v.string(),
      priceCode: v.string(),
      disallowDebt: v.boolean(),
    }),
    3: v.object({
      stageType: v.picklist(["WITHDRAW"]),
      network: v.picklist(["ETHEREUM", "BINANCE", "POLYGON", "OPTIMISM", "INTERNAL"]),
      asset: v.string(),
      amount: v.string(),
      to: Address,
      destination: v.object({
        address: Address,
        network: v.picklist(["ETHEREUM", "BINANCE", "POLYGON", "OPTIMISM", "INTERNAL"]),
      }),
    }),
  }),
  creationTime: v.string(),
  updatedAt: v.string(),
});

export const PriceLockResponse = v.object({
  code: v.string(),
  userId: v.string(),
  userNumberId: v.string(),
  userExternalId: v.optional(v.string()),
  side: v.picklist(["BUY", "SELL"]),
  asset: v.string(),
  against: v.string(),
  price: v.string(),
});

export const QuoteResponse = v.object({
  ticker: v.string(),
  timestamp: v.string(),
  buy: v.string(),
  sell: v.string(),
});

export const LimitType = ["EXCHANGE", "REMITTANCE"] as const;
export const LimitsResponse = v.array(
  v.object({
    exchangeCountry: v.string(),
    asset: v.string(),
    type: v.picklist(LimitType),
    yearlyLimit: v.string(),
    availableYearlyLimit: v.string(),
    monthlyLimit: v.string(),
    availableMonthlyLimit: v.string(),
  }),
);

export const BalancesResponse = v.object({
  userId: v.string(),
  userNumberId: v.string(),
  userExternalId: v.optional(v.string()),
  balance: v.object({
    ARS: v.optional(v.string()),
    USD: v.optional(v.string()),
    BRL: v.optional(v.string()),
    CLP: v.optional(v.string()),
    COP: v.optional(v.string()),
    PUSD: v.optional(v.string()),
    CRC: v.optional(v.string()),
    MXN: v.optional(v.string()),
    PHP: v.optional(v.string()),
    BOB: v.optional(v.string()),

    USDC: v.optional(v.string()),
  }),
  updatedAt: v.string(),
});

const onboardingTaskStatus = ["PENDING", "COMPLETED"] as const;
const OnboardingTaskInfo = v.optional(
  v.object({
    required: v.boolean(),
    status: v.picklist(onboardingTaskStatus),
    rejectionReason: v.optional(v.string()),
  }),
);
const UserOnboardingTasks = v.object({
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

export const CountryCode = [
  "AR",
  "CL",
  "BR",
  "CO",
  "PA",
  "CR",
  "GT",
  "MX",
  "PH",
  "BO",

  // for testing
  "US",
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

  // for testing
  US: "ARGENTINA",
};
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

  // for testing
  US: "Argentina",
};

export const MantecaCurrency: (typeof Currency)[number][] = [
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
] as const;

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

export const allowedCountries = new Map<(typeof CountryCode)[number], { notAllowedIds: string[] }>([
  ["AR", { notAllowedIds: ["dl"] }],
  ["BR", { notAllowedIds: [] }],
  // ["CL", { notAllowedIds: [] }],
  // ["CO", { notAllowedIds: [] }],
  // ["PA", { notAllowedIds: [] }],
  // ["CR", { notAllowedIds: [] }],
  // ["GT", { notAllowedIds: [] }],
  // ["MX", { notAllowedIds: [] }],
  // ["PH", { notAllowedIds: [] }],
  // ["BO", { notAllowedIds: [] }],

  // for testing
  ["US", { notAllowedIds: [] }],
]);

export const NewUserResponse = v.object({
  user: v.object({
    id: v.string(),
    numberId: v.string(),
    externalId: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    status: v.picklist(["ONBOARDING", "ACTIVE", "INACTIVE"]),
    type: v.picklist(["INDIVIDUAL", "BUSINESS"]),
    exchange: v.picklist(Exchange),
    onboarding: UserOnboardingTasks,
    creationTime: v.string(),
    updatedAt: v.string(),
  }),
  person: v.optional(
    v.object({
      legalId: v.optional(v.string()),
      email: v.optional(v.string()),
      flags: v.object({
        isDead: v.boolean(),
        isPEP: v.boolean(),
        isFACTA: v.boolean(),
        isFEP: v.boolean(),
      }),
      personalData: v.optional(
        v.object({
          name: v.optional(v.string()),
          surname: v.optional(v.string()),
          sex: v.optional(v.string()),
          work: v.optional(v.string()),
          birthDate: v.optional(v.string()),
          phoneNumber: v.optional(v.string()),
          nationality: v.optional(v.string()),
          maritalStatus: v.optional(v.string()),
          cleanName: v.optional(v.string()),
          address: v.optional(
            v.object({
              postalCode: v.optional(v.string()),
              locality: v.optional(v.string()),
              province: v.optional(v.string()),
              street: v.optional(v.string()),
              floor: v.optional(v.string()),
              numeration: v.optional(v.string()),
            }),
          ),
          document: v.optional(
            v.object({
              type: v.optional(v.string()),
              id: v.optional(v.string()),
            }),
          ),
        }),
      ),
    }),
  ),
});

export const UserStatus = ["ONBOARDING", "ACTIVE", "INACTIVE"] as const;
export const UserResponse = v.object({
  id: v.string(),
  numberId: v.string(),
  externalId: v.optional(v.string()),
  sessionId: v.optional(v.string()),
  status: v.picklist(UserStatus),
  type: v.picklist(["INDIVIDUAL", "BUSINESS"]),
  exchange: v.picklist(Exchange),
  onboarding: UserOnboardingTasks,
  creationTime: v.string(),
  updatedAt: v.string(),
});

export const UserOnboarding = v.object({
  externalId: v.optional(v.string()),
  email: v.string(),
  legalId: v.string(),
  type: v.picklist(["INDIVIDUAL", "BUSINESS"]),
  exchange: v.picklist(Exchange),
  personalData: v.object({
    name: v.string(),
    surname: v.string(),
    sex: v.picklist(["M", "F", "X"]),
    work: v.string(),
    birthDate: v.string(),
    isPep: v.boolean(),
    isFacta: v.boolean(),
    isFep: v.boolean(),
    phoneNumber: v.string(),
    nationality: v.string(),
    maritalStatus: v.picklist(["Soltero"]),
    address: v.optional(
      v.object({
        street: v.string(),
        postalCode: v.optional(v.string()),
        locality: v.optional(v.string()),
        province: v.optional(v.string()),
        floor: v.optional(v.string()),
        apartment: v.optional(v.string()),
      }),
    ),
  }),
});

export const UploadIdentityFile = v.object({
  userAnyId: v.string(),
  side: v.picklist(["FRONT", "BACK"]),
  fileName: v.string(),
});

export const UploadIdentityFileResponse = v.object({
  url: v.string(),
});
// #endregion schemas

// #region utils
async function request<TInput, TOutput, TIssue extends v.BaseIssue<unknown>>(
  schema: v.BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "GET" | "POST" | "PUT" | "PATCH" = body === undefined ? "GET" : "POST",
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
  if (rawBody.byteLength === 0) return v.parse(schema, {});
  return v.parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}

export function validatePersonaAccount(personaAccount: v.InferOutput<typeof Account>) {
  const identificationNumbers = personaAccount.attributes["identification-numbers"];
  if (!identificationNumbers) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  if (Object.keys(identificationNumbers).length === 0) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  // TODO support multiple id documents
  if (Object.keys(identificationNumbers).length > 1) throw new Error(ErrorCodes.MULTIPLE_IDENTIFICATION_NUMBERS);
  const identification = Object.values(identificationNumbers)[0];
  if (!identification) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  if (!identification[0]) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  // TODO support multiple id documents
  if (identification.length > 1) throw new Error(ErrorCodes.MULTIPLE_IDENTIFICATION_NUMBERS);
  const countryCode = identification[0]["issuing-country"];
  const idType = identification[0]["identification-class"];
  const country = allowedCountries.get(countryCode as (typeof CountryCode)[number]);
  if (!country) throw new Error(ErrorCodes.COUNTRY_NOT_ALLOWED);
  if (country.notAllowedIds.includes(idType)) throw new Error(ErrorCodes.ID_NOT_ALLOWED);

  const additionalData = v.safeParse(MantecaOnboarding, {
    tin: personaAccount.attributes.fields.tin?.value,
    gender: personaAccount.attributes.fields.gender?.value,
    isnotfacta: personaAccount.attributes.fields.isnotfacta?.value,
  });
  if (!additionalData.success) throw new Error(ErrorCodes.BAD_KYC_ADDITIONAL_DATA);
}

export function getDocumentId(inquiry: v.InferOutput<typeof Inquiry>) {
  const documents = inquiry.relationships.documents?.data;
  if (!documents) throw new Error(ErrorCodes.NO_DOCUMENT);
  if (!documents[0]) throw new Error(ErrorCodes.NO_DOCUMENT);
  if (documents.length > 1) throw new Error(ErrorCodes.MULTIPLE_DOCUMENTS);
  const documentId = documents[0].id;
  if (!documentId) throw new Error(ErrorCodes.NO_DOCUMENT);
  return documentId;
}

export const getExchange = (countryCode: string): (typeof Exchange)[number] => {
  const exchange = ExchangeByCountry[countryCode as (typeof CountryCode)[number]];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!exchange) throw new Error(`Invalid country: ${countryCode}`);
  return exchange;
};

const getSupportedByCountry = (countryCode?: string): (typeof MantecaCurrency)[number][] => {
  if (!countryCode) return [];
  const exchange = ExchangeByCountry[countryCode as (typeof CountryCode)[number]];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!exchange) return [];
  return CurrenciesByExchange[exchange];
};

export const getNationality = (countryCode: string): string => {
  const nationality = Nationality[countryCode as (typeof CountryCode)[number]];
  if (!nationality) throw new Error(`Invalid country: ${countryCode}`);
  return nationality;
};

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
