import { captureException } from "@sentry/core";
import { eq } from "drizzle-orm";
import { alpha2ToAlpha3 } from "i18n-iso-countries";
import crypto from "node:crypto";
import {
  array,
  literal,
  nullish,
  number,
  object,
  optional,
  parse,
  picklist,
  string,
  union,
  unknown,
  variant,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../../database";
import {
  getAccount,
  getDocument,
  getValidDocumentForBridge,
  type IdentificationClasses as PersonaIdentificationClasses,
} from "../persona";
import ServiceError from "../ServiceError";

import type * as shared from "./shared";

if (!process.env.BRIDGE_API_URL) throw new Error("missing bridge api url");
const baseURL = process.env.BRIDGE_API_URL;

if (!process.env.BRIDGE_API_KEY) throw new Error("missing bridge api key");
const apiKey = process.env.BRIDGE_API_KEY;

// #region services
export async function createCustomer(user: InferInput<typeof CreateCustomer>) {
  return await request(NewCustomer, "/customers", {}, user, "POST").catch((error: unknown) => {
    if (error instanceof ServiceError && typeof error.cause === "string") {
      if (error.cause.includes(BridgeApiErrorCodes.EMAIL_ALREADY_EXISTS)) {
        captureException(new Error("email already exists"), { level: "error" });
        throw new Error(ErrorCodes.EMAIL_ALREADY_EXISTS);
      }
      if (error.cause.includes(BridgeApiErrorCodes.INVALID_PARAMETERS) && error.cause.includes("residential_address")) {
        captureException(new Error("invalid address"), { level: "warning" });
        throw new Error(ErrorCodes.INVALID_ADDRESS);
      }
    }
    throw error;
  });
}

export async function updateCustomer(customerId: string, user: Partial<InferInput<typeof CreateCustomer>>) {
  return await request(NewCustomer, `/customers/${customerId}`, {}, user, "PUT");
}

export async function agreementLink(redirectUri?: string): Promise<string> {
  const response = await request(AgreementLinkResponse, `/customers/tos_links`, {}, undefined, "POST");
  return `${response.url}${redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : ""}`;
}

export async function getCustomer(customerId: string) {
  return await request(CustomerResponse, `/customers/${customerId}`).catch((error: unknown) => {
    if (
      error instanceof ServiceError &&
      typeof error.cause === "string" &&
      error.cause.includes(BridgeApiErrorCodes.NOT_FOUND)
    ) {
      return;
    }
    throw error;
  });
}

export async function getQuote(
  from: (typeof QuoteCurrency)[number],
  to: (typeof QuoteCurrency)[number],
): Promise<InferOutput<typeof shared.QuoteResponse>> {
  const quote = await request(Quote, `/exchange_rates?from=${CurrencyMapping[from]}&to=${CurrencyMapping[to]}`).catch(
    (error: unknown) => {
      captureException(error, { level: "error" });
    },
  );
  if (!quote) return;
  return { buyRate: quote.buy_rate, sellRate: quote.sell_rate };
}

export async function createVirtualAccount(customerId: string, data: InferInput<typeof CreateVirtualAccount>) {
  return await request(VirtualAccount, `/customers/${customerId}/virtual_accounts`, {}, data, "POST");
}

export async function getVirtualAccounts(customerId: string) {
  const path = `/customers/${customerId}/virtual_accounts` as const;
  const first = await request(VirtualAccounts, `${path}?limit=20`);
  const all = [...first.data];
  const paginated = all.length < first.count;
  while (all.length < first.count) {
    const last = all.at(-1);
    if (!last) break;
    const page = await request(VirtualAccounts, `${path}?limit=20&starting_after=${last.id}`);
    if (page.data.length === 0) break;
    all.push(...page.data);
  }
  if (paginated)
    captureException(new Error("bridge virtual accounts pagination"), {
      level: "warning",
      contexts: { bridge: { customerId, count: first.count } },
    });
  return all;
}

export async function createLiquidationAddress(customerId: string, data: InferInput<typeof CreateLiquidationAddress>) {
  return await request(LiquidationAddress, `/customers/${customerId}/liquidation_addresses`, {}, data, "POST");
}

export async function getLiquidationAddresses(customerId: string) {
  const path = `/customers/${customerId}/liquidation_addresses` as const;
  const first = await request(LiquidationAddresses, `${path}?limit=20`);
  const all = [...first.data];
  const paginated = all.length < first.count;
  while (all.length < first.count) {
    const last = all.at(-1);
    if (!last) break;
    const page = await request(LiquidationAddresses, `${path}?limit=20&starting_after=${last.id}`);
    if (page.data.length === 0) break;
    all.push(...page.data);
  }
  if (paginated)
    captureException(new Error("bridge liquidation addresses pagination"), {
      level: "warning",
      contexts: { bridge: { customerId, count: first.count } },
    });
  return all;
}

type GetProvider = {
  countryCode?: string;
  credentialId: string;
  customerId?: null | string;
  redirectURL?: string;
};

export async function getProvider(params: GetProvider): Promise<InferOutput<typeof shared.ProviderInfo>> {
  const currencies: (typeof SupportedCurrency)[number][] = [];
  const cryptoCurrencies: {
    cryptoCurrency: (typeof SupportedCrypto)[number];
    network: (typeof shared.CryptoNetwork)[number];
  }[] = [];

  if (!SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]]) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    return { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" };
  }

  for (const cryptoRail of SupportedCryptoPaymentRail) {
    for (const cryptoCurrency of CryptoCurrencyByPaymentRail[cryptoRail]) {
      cryptoCurrencies.push({ cryptoCurrency, network: CryptoPaymentRailMapping[cryptoRail] });
    }
  }

  if (params.customerId) {
    const bridgeUser = await getCustomer(params.customerId);
    if (!bridgeUser) throw new Error(ErrorCodes.BAD_BRIDGE_ID);
    switch (bridgeUser.status) {
      case "offboarded":
      case "rejected":
      case "paused":
        captureException(new Error("bridge user not available"), { contexts: { bridgeUser }, level: "warning" });
        return { status: "NOT_AVAILABLE", onramp: { currencies: [], cryptoCurrencies: [] } };
      case "under_review":
      case "awaiting_questionnaire":
      case "awaiting_ubo":
      case "incomplete":
      case "not_started":
        captureException(new Error("bridge user onboarding"), { contexts: { bridgeUser }, level: "warning" });
        return {
          status: "ONBOARDING",
          onramp: {
            currencies: (["base", "sepa"] as const).flatMap((endorsement) => CurrencyByEndorsement[endorsement]),
            cryptoCurrencies,
          },
        };
      case "active":
        break;
    }

    if (bridgeUser.future_requirements_due?.length) {
      // TODO handle future requirements
      captureException(new Error("bridge future requirements due"), {
        contexts: {
          bridge: { bridgeId: params.customerId, futureRequirementsDue: bridgeUser.future_requirements_due },
        },
        level: "warning",
      });
    }

    if (bridgeUser.requirements_due?.length) {
      // TODO handle requirements due
      captureException(new Error("bridge requirements due"), {
        contexts: { bridge: { bridgeId: params.customerId, requirementsDue: bridgeUser.requirements_due } },
        level: "warning",
      });
    }

    for (const endorsement of bridgeUser.endorsements) {
      if (endorsement.status !== "approved") {
        // TODO handle pending tasks
        captureException(new Error("endorsement not approved"), {
          contexts: { bridge: { bridgeId: params.customerId, endorsement } },
          level: "warning",
        });
        break;
      }

      currencies.push(...CurrencyByEndorsement[endorsement.name]);

      if (endorsement.additional_requirements?.length) {
        // TODO handle additional requirements
        captureException(new Error("additional requirements"), {
          contexts: { bridge: { bridgeId: params.customerId, endorsement } },
          level: "warning",
        });
      }

      if (endorsement.requirements.missing) {
        captureException(new Error("requirements missing"), {
          contexts: { bridge: { bridgeId: params.customerId, endorsement } },
          level: "warning",
        });
      }
    }

    return { status: "ACTIVE", onramp: { currencies, cryptoCurrencies } };
  }

  const personaAccount = await getAccount(params.credentialId, "bridge");
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);

  const countryCode = personaAccount.attributes["country-code"];
  const validDocument = getValidDocumentForBridge(personaAccount.attributes.fields.documents.value);
  if (!validDocument) throw new Error(ErrorCodes.NO_DOCUMENT);
  const bridgeIdType = idClassToBridge(validDocument.id_class.value);
  if (!bridgeIdType) {
    captureException(new Error("bridge not found identification class"), {
      contexts: { bridge: { credentialId: params.credentialId, idClass: validDocument.id_class.value } },
      level: "warning",
    });
    return { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" };
  }

  const country = alpha2ToAlpha3(countryCode);
  if (!country) throw new Error(ErrorCodes.NO_COUNTRY_ALPHA3);

  if (countryCode === "US" && !personaAccount.attributes["social-security-number"]) {
    throw new Error(ErrorCodes.NO_SOCIAL_SECURITY_NUMBER);
  }

  const endorsements: (typeof Endorsements)[number][] = ["base", "sepa"];
  if (countryCode === "MX") endorsements.push("spei");
  if (countryCode === "BR") endorsements.push("pix");
  if (countryCode === "GB") endorsements.push("faster_payments");
  for (const endorsement of endorsements) currencies.push(...CurrencyByEndorsement[endorsement]);

  let bridgeRedirectURL: undefined | URL = undefined;
  if (params.redirectURL) {
    bridgeRedirectURL = new URL(params.redirectURL);
    bridgeRedirectURL.searchParams.set("provider", "bridge" satisfies (typeof shared.RampProvider)[number]);
  }
  return {
    status: "NOT_STARTED",
    tosLink: await agreementLink(bridgeRedirectURL?.toString()),
    onramp: { currencies, cryptoCurrencies },
  };
}

type Onboarding = {
  acceptedTermsId: string;
  credentialId: string;
  customerId: null | string;
};

export async function onboarding(params: Onboarding): Promise<void> {
  if (params.customerId) throw new Error(ErrorCodes.ALREADY_ONBOARDED);

  if (!SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]]) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  const personaAccount = await getAccount(params.credentialId, "bridge");
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);

  const countryCode = personaAccount.attributes["country-code"];

  const validDocument = getValidDocumentForBridge(personaAccount.attributes.fields.documents.value);
  if (!validDocument) throw new Error(ErrorCodes.NO_DOCUMENT);

  const endorsements: (typeof Endorsements)[number][] = ["base", "sepa"];
  if (countryCode === "MX") endorsements.push("spei");
  if (countryCode === "BR") endorsements.push("pix");
  if (countryCode === "GB") endorsements.push("faster_payments");

  const identityDocument = await getDocument(validDocument.id_document_id.value);
  const frontDocumentURL = identityDocument.attributes["front-photo"]?.url;
  if (!frontDocumentURL) throw new Error(ErrorCodes.NO_DOCUMENT_FILE);
  const backDocumentURL = identityDocument.attributes["back-photo"]?.url;

  const [frontFileEncoded, backFileEncoded] = await Promise.all([
    fetchAndEncodeFile(frontDocumentURL, identityDocument.attributes["front-photo"]?.filename ?? "front-photo.jpg"),
    backDocumentURL
      ? fetchAndEncodeFile(backDocumentURL, identityDocument.attributes["back-photo"]?.filename ?? "back-photo.jpg")
      : undefined,
  ]);

  const bridgeIdType = idClassToBridge(validDocument.id_class.value);
  if (!bridgeIdType) throw new Error(ErrorCodes.NOT_FOUND_IDENTIFICATION_CLASS);
  const country = alpha2ToAlpha3(countryCode);
  if (!country) throw new Error(ErrorCodes.NO_COUNTRY_ALPHA3);

  const identifyingInformation: (InferInput<typeof IdentityDocument> | InferInput<typeof TIN>)[] = [
    {
      type: bridgeIdType,
      issuing_country: validDocument.id_issuing_country.value,
      number: validDocument.id_number.value,
      image_front: frontFileEncoded,
      image_back: backFileEncoded,
    },
  ];

  if (countryCode === "US") {
    const ssn = personaAccount.attributes["social-security-number"];
    if (!ssn) throw new Error(ErrorCodes.NO_SOCIAL_SECURITY_NUMBER);

    identifyingInformation.push({
      type: "ssn",
      number: ssn,
      issuing_country: "USA",
    });
  }

  const customer = await createCustomer({
    type: "individual",
    first_name: personaAccount.attributes.fields.name.value.first.value,
    last_name: personaAccount.attributes.fields.name.value.last.value,
    email: personaAccount.attributes["email-address"],
    phone: personaAccount.attributes.fields.phone_number.value,
    residential_address: {
      street_line_1: personaAccount.attributes["address-street-1"],
      street_line_2: personaAccount.attributes["address-street-2"] ?? undefined,
      postal_code: personaAccount.attributes["address-postal-code"],
      subdivision: personaAccount.attributes["address-subdivision"],
      country,
      city: personaAccount.attributes["address-city"],
    },
    birth_date: personaAccount.attributes.fields.birthdate.value,
    signed_agreement_id: params.acceptedTermsId,
    endorsements,
    nationality: country,
    identifying_information: identifyingInformation,
  });

  await database.update(credentials).set({ bridgeId: customer.id }).where(eq(credentials.id, params.credentialId));
}

export async function getDepositDetails(
  currency: (typeof SupportedCurrency)[number],
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
): Promise<InferOutput<typeof shared.DepositDetails>[]> {
  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }
  if (customer.status !== "active") throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);

  const approvedEndorsements = customer.endorsements.filter((endorsement) => endorsement.status === "approved");
  const availableCurrencies = approvedEndorsements.flatMap((endorsement) => CurrencyByEndorsement[endorsement.name]);
  if (!availableCurrencies.includes(currency)) throw new Error(ErrorCodes.NOT_AVAILABLE_CURRENCY);
  const virtualAccounts = await getVirtualAccounts(customer.id);
  let virtualAccount = virtualAccounts.find(
    ({ source_deposit_instructions, status }) =>
      source_deposit_instructions.currency === CurrencyMapping[currency] && status === "activated",
  );

  virtualAccount ??= await createVirtualAccount(customer.id, {
    source: { currency: CurrencyMapping[currency] },
    developer_fee_percentage: "0.0",
    destination: { currency: "usdc", payment_rail: supportedChainId, address: account },
  });

  return getDepositDetailsFromVirtualAccount(virtualAccount, account);
}

export async function getCryptoDepositDetails(
  cryptoCurrency: (typeof SupportedCrypto)[number],
  network: (typeof shared.CryptoNetwork)[number],
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
): Promise<InferOutput<typeof shared.DepositDetails>[]> {
  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof shared.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }
  if (customer.status !== "active") throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);

  const paymentRail = NetworkToCryptoPaymentRail[network];
  if (!CryptoCurrencyByPaymentRail[paymentRail].includes(cryptoCurrency)) {
    throw new Error(ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL);
  }

  const liquidationAddresses = await getLiquidationAddresses(customer.id);
  let liquidationAddress = liquidationAddresses.find(
    ({ chain: bridgeChain, currency }) =>
      bridgeChain === paymentRail && currency === CryptocurrencyMapping[cryptoCurrency],
  );

  liquidationAddress ??= await createLiquidationAddress(customer.id, {
    destination_address: account,
    destination_currency: "usdc",
    destination_payment_rail: supportedChainId,
    currency: CryptocurrencyMapping[cryptoCurrency],
    chain: paymentRail,
  });

  return getDepositDetailsFromLiquidationAddress(liquidationAddress, account);
}
// #endregion services

// #region fiat currencies
const Endorsements = ["base", "faster_payments", "pix", "sepa", "spei"] as const; // cspell:ignore spei, sepa
export const BridgeCryptocurrency = ["usdc", "usdt"] as const;
export const BridgeCurrency = ["brl", "eur", "gbp", "mxn", "usd"] as const;

export const PaymentRail = ["ach_push", "faster_payments", "pix", "sepa", "spei", "wire"] as const;
const VirtualAccountStatus = ["activated", "deactivated"] as const;

export const SupportedCurrency = [
  "BRL",
  "EUR",
  "GBP",
  "MXN",
  "USD",
] as const satisfies readonly (typeof shared.Currency)[number][];

export const QuoteCurrency = [
  "BRL",
  "EUR",
  "GBP",
  "MXN",
  "USD",
] as const satisfies readonly (typeof SupportedCurrency)[number][];

const CurrencyMapping: Record<(typeof SupportedCurrency)[number], (typeof BridgeCurrency)[number]> = {
  BRL: "brl",
  EUR: "eur",
  GBP: "gbp",
  MXN: "mxn",
  USD: "usd",
} as const;

const CurrencyByEndorsement: Record<(typeof Endorsements)[number], (typeof SupportedCurrency)[number][]> = {
  base: ["USD"],
  faster_payments: ["GBP"],
  pix: ["BRL"],
  sepa: ["EUR"],
  spei: ["MXN"],
};
// #endregion fiat currencies

// #region crypto currencies
export const SupportedCrypto = ["USDT", "USDC"] as const satisfies readonly (typeof shared.Cryptocurrency)[number][];

export const CryptocurrencyMapping: Record<(typeof SupportedCrypto)[number], (typeof BridgeCryptocurrency)[number]> = {
  USDT: "usdt",
  USDC: "usdc",
} as const;

export const CryptoPaymentRail = [
  "avalanche_c_chain",
  "arbitrum",
  "ethereum",
  "optimism",
  "polygon",
  "stellar",
  "solana",
  "base",
  "tron",
] as const;

export const SupportedCryptoPaymentRail = [
  "tron",
  "solana",
  "stellar",
] as const satisfies readonly (typeof CryptoPaymentRail)[number][];

const CryptoCurrencyByPaymentRail: Record<
  (typeof SupportedCryptoPaymentRail)[number],
  (typeof SupportedCrypto)[number][]
> = {
  tron: ["USDT"],
  solana: ["USDC"],
  stellar: ["USDC"],
};

const CryptoPaymentRailMapping: Record<
  (typeof SupportedCryptoPaymentRail)[number],
  (typeof shared.CryptoNetwork)[number]
> = {
  tron: "TRON",
  stellar: "STELLAR",
  solana: "SOLANA",
} as const;

const NetworkToCryptoPaymentRail = createReverseMapping(CryptoPaymentRailMapping);
// #endregion crypto currencies

// #region schemas
const SupportedOnRampChainId: Record<
  (typeof shared.SupportedChainId)[number],
  (typeof CryptoPaymentRail)[number] | undefined
> = {
  [optimism.id]: "optimism",
  [base.id]: "base",
  [baseSepolia.id]: "base",
  [optimismSepolia.id]: "optimism",
} as const;

export const IdentityDocumentType = [
  "drivers_license",
  "matriculate_id",
  "military_id",
  "national_id",
  "passport",
  "permanent_residency_id",
  "state_or_provincial_id",
  "visa",
] as const;

export const TINType = [
  "drivers_license",
  "matriculate_id",
  "military_id",
  "national_id",
  "passport",
  "permanent_residency_id",
  "state_or_provincial_id",
  "visa",
  "abn",
  "acn",
  "ahv",
  "ak",
  "aom",
  "arbn", // cspell:ignore arbn
  "avs",
  "bc",
  "bce",
  "bin",
  "bir",
  "bp",
  "brn",
  "bsn",
  "bvn",
  "cc",
  "cdi",
  "cedula_juridica", // cspell:ignore cedula_juridica
  "cf",
  "cif",
  "cin",
  "cipc", // cspell:ignore cipc
  "cn",
  "cnp",
  "cnpj", // cspell:ignore cnpj
  "cpf",
  "cpr",
  "crc",
  "crib",
  "crn",
  "cro",
  "cui",
  "cuil", // cspell:ignore cuil
  "curp", // cspell:ignore curp
  "cuit", // cspell:ignore cuit
  "cvr",
  "edrpou", // cspell:ignore edrpou
  "ein",
  "embg", // cspell:ignore embg
  "emirates_id",
  "en",
  "fin",
  "fn",
  "gstin", // cspell:ignore gstin
  "gui",
  "hetu", // cspell:ignore hetu
  "hkid", // cspell:ignore hkid
  "hn",
  "ic",
  "ico",
  "id",
  "id_broj", // cspell:ignore id_broj
  "idno", // cspell:ignore idno
  "idnp", // cspell:ignore idnp
  "idnr", // cspell:ignore idnr
  "if",
  "iin",
  "ik",
  "inn",
  "ird",
  "itin", // cspell:ignore itin
  "itr",
  "iva",
  "jmbg", // cspell:ignore jmbg
  "kbo",
  "kvk",
  "matricule", // cspell:ignore matricule
  "mf",
  "mn",
  "ms",
  "mst",
  "nic",
  "nicn", // cspell:ignore nicn
  "nie",
  "nif",
  "nin",
  "nino", // cspell:ignore nino
  "nip",
  "nipc", // cspell:ignore nipc
  "nipt", // cspell:ignore nipt
  "nit",
  "npwp", // cspell:ignore npwp
  "nric", // cspell:ignore nric
  "nrn",
  "nrt",
  "tn",
  "nuit", // cspell:ignore nuit
  "nzbn", // cspell:ignore nzbn
  "oib",
  "org",
  "other",
  "pan",
  "partita_iva",
  "pesel", // cspell:ignore pesel
  "pib",
  "pin",
  "pk",
  "ppsn", // cspell:ignore ppsn
  "qid",
  "rc",
  "regon", // cspell:ignore regon
  "rfc",
  "ricn", // cspell:ignore ricn
  "rif",
  "rn",
  "rnc",
  "rnokpp", // cspell:ignore rnokpp
  "rp",
  "rrn",
  "rtn",
  "ruc",
  "rut",
  "si",
  "sin",
  "siren",
  "siret",
  "spi",
  "ssm",
  "ssn",
  "steuer_id", // cspell:ignore steuer_id
  "strn", // cspell:ignore strn
  "tckn", // cspell:ignore tckn
  "tfn",
  "tin",
  "tpin", // cspell:ignore tpin
  "trn",
  "ucn",
  "uen",
  "uic",
  "uid",
  "usc",
  "ust_idnr",
  "utr",
  "vat",
  "vkn",
  "voen", // cspell:ignore voen
  "y_tunnus", // cspell:ignore y_tunnus
] as const;

const CustomerStatus = [
  "awaiting_questionnaire",
  "awaiting_ubo",
  "under_review",
  "not_started",
  "incomplete",
  "offboarded",
  "rejected",
  "paused",
  "active",
] as const;

const AdditionalRequirements = [
  "kyc_with_proof_of_address",
  "tos_v2_acceptance",
  "tos_acceptance",
  "kyc_approval",
] as const;

const CapabilitiesStatus = ["pending", "active", "inactive", "rejected"] as const;
const EndorsementStatus = ["incomplete", "approved", "revoked"] as const;

const IdClassToBridge: Record<
  (typeof PersonaIdentificationClasses)[number],
  (typeof IdentityDocumentType)[number] | undefined
> = {
  id: "national_id",
  pp: "passport",
  dl: "drivers_license",
  wp: undefined,
  rp: undefined,
  pr: "permanent_residency_id",
  visa: "visa",
};

const Quote = object({ midmarket_rate: string(), buy_rate: string(), sell_rate: string() }); // cspell:ignore midmarket

const AgreementLinkResponse = object({ url: string() });

const CustomerResponse = object({
  id: string(),
  status: picklist(CustomerStatus),
  capabilities: optional(
    object({
      payin_crypto: optional(picklist(CapabilitiesStatus)), // cspell:ignore payin_crypto
      payout_crypto: optional(picklist(CapabilitiesStatus)),
      payin_fiat: optional(picklist(CapabilitiesStatus)), // cspell:ignore payin_fiat
      payout_fiat: optional(picklist(CapabilitiesStatus)),
    }),
  ),
  rejection_reasons: optional(array(object({ developer_reason: string(), reason: string(), created_at: string() }))),
  endorsements: array(
    object({
      name: picklist(Endorsements),
      status: picklist(EndorsementStatus),
      additional_requirements: optional(array(picklist(AdditionalRequirements))),
      requirements: object({
        complete: array(string()),
        pending: array(string()),
        missing: nullish(unknown()),
        issues: array(union([string(), unknown()])),
      }),
    }),
  ),
  future_requirements_due: optional(array(picklist(["id_verification"]))),
  requirements_due: optional(array(picklist(["id_verification", "external_account"]))),
});

const IdentityDocument = object({
  type: picklist(IdentityDocumentType),
  issuing_country: string(),
  number: string(),
  image_front: string(),
  image_back: optional(string()),
  expiration: optional(string()),
});

const TIN = object({
  type: picklist(TINType),
  number: string(),
  issuing_country: string(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateCustomer = object({
  type: literal("individual"),
  first_name: string(),
  middle_name: optional(string()),
  last_name: string(),
  transliterated_first_name: optional(string()),
  transliterated_middle_name: optional(string()),
  transliterated_last_name: optional(string()),
  email: string(),
  phone: string(),
  residential_address: object({
    street_line_1: string(),
    street_line_2: optional(string()),
    city: string(),
    subdivision: optional(string()),
    postal_code: optional(string()),
    country: string(),
  }),
  transliterated_residential_address: optional(
    object({
      street_line_1: optional(string()),
      street_line_2: optional(string()),
      city: optional(string()),
      subdivision: optional(string()),
      postal_code: optional(string()),
      country: optional(string()),
    }),
  ),
  birth_date: string(),
  signed_agreement_id: string(),
  nationality: string(),

  identifying_information: array(union([IdentityDocument, TIN])),
  endorsements: optional(array(picklist(Endorsements))),
});

const NewCustomer = object({
  status: picklist(CustomerStatus),
  id: string(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateVirtualAccount = object({
  developer_fee_percentage: optional(string()),
  source: object({
    currency: picklist(BridgeCurrency),
  }),
  destination: object({
    currency: picklist(BridgeCryptocurrency),
    payment_rail: picklist(CryptoPaymentRail),
    address: Address,
  }),
});

const VirtualAccount = object({
  id: string(),
  status: picklist(VirtualAccountStatus),
  developer_fee_percentage: optional(string()),
  source_deposit_instructions: variant("currency", [
    object({
      currency: literal("usd" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: array(picklist(["ach_push", "wire"] as const satisfies (typeof PaymentRail)[number][])),
      bank_name: string(),
      bank_address: string(),
      bank_routing_number: string(),
      bank_account_number: string(),
      bank_beneficiary_name: string(),
      bank_beneficiary_address: string(),
    }),
    object({
      currency: literal("eur" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: array(picklist(["sepa"] as const satisfies (typeof PaymentRail)[number][])),
      bank_name: string(),
      bank_address: string(),
      account_holder_name: string(),
      iban: string(), // cspell:ignore iban
      bic: string(),
    }),
    object({
      currency: literal("mxn" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: array(picklist(["spei"] as const satisfies (typeof PaymentRail)[number][])),
      account_holder_name: string(),
      clabe: string(), // cspell:ignore clabe
    }),
    object({
      currency: literal("gbp" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: array(picklist(["faster_payments"] as const satisfies (typeof PaymentRail)[number][])),
      account_number: string(),
      sort_code: string(),
      account_holder_name: string(),
      bank_name: string(),
      bank_address: string(),
    }),
  ]),
  destination: object({
    address: string(),
  }),
});
const VirtualAccounts = object({ count: number(), data: array(VirtualAccount) });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateLiquidationAddress = object({
  currency: picklist([...BridgeCryptocurrency, "any"]),
  chain: picklist([...CryptoPaymentRail, "evm"]),
  destination_payment_rail: picklist([...PaymentRail, ...CryptoPaymentRail]),
  destination_currency: picklist([...BridgeCurrency, ...BridgeCryptocurrency]),
  destination_address: Address,
});

const LiquidationAddress = object({
  id: string(),
  currency: picklist([...BridgeCryptocurrency, "any"]),
  chain: picklist([...CryptoPaymentRail, "evm"]),
  address: string(),
  destination_address: string(),
});

const LiquidationAddresses = object({ count: number(), data: array(LiquidationAddress) });
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
  const payload = {
    method,
    headers: {
      ...headers,
      "api-key": apiKey,
      ...(method === "POST" && { "Idempotency-Key": crypto.randomUUID() }),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  };
  const response = await fetch(`${baseURL}${url}`, payload);

  if (!response.ok) throw new ServiceError("Bridge", response.status, await response.text());
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return parse(schema, {});
  return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}

async function encodeFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const type = file.type === "" ? "image/jpeg" : file.type;
  return `data:${type};base64,${base64}`;
}

async function fetchAndEncodeFile(url: string, fileName: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new ServiceError("Bridge", response.status, await response.text());
  const file = await response.blob();
  return encodeFile(new File([file], fileName));
}

function idClassToBridge(idClass: string): (typeof IdentityDocumentType)[number] | undefined {
  return IdClassToBridge[idClass as keyof typeof IdClassToBridge];
}

function getDepositDetailsFromVirtualAccount(
  virtualAccount: InferOutput<typeof VirtualAccount>,
  account: string,
): InferOutput<typeof shared.DepositDetails>[] {
  if (virtualAccount.destination.address.toLowerCase() !== account.toLowerCase()) {
    throw new Error(ErrorCodes.INVALID_ACCOUNT);
  }
  switch (virtualAccount.source_deposit_instructions.currency) {
    case "usd":
      return [
        {
          network: "ACH",
          displayName: "ACH",
          beneficiaryName: virtualAccount.source_deposit_instructions.bank_beneficiary_name,
          routingNumber: virtualAccount.source_deposit_instructions.bank_routing_number,
          accountNumber: virtualAccount.source_deposit_instructions.bank_account_number,
          bankAddress: virtualAccount.source_deposit_instructions.bank_address,
          bankName: virtualAccount.source_deposit_instructions.bank_name,
          fee: "0.0",
          estimatedProcessingTime: "1 - 3 business days",
        },
        {
          network: "WIRE",
          displayName: "WIRE",
          beneficiaryName: virtualAccount.source_deposit_instructions.bank_beneficiary_name,
          routingNumber: virtualAccount.source_deposit_instructions.bank_routing_number,
          accountNumber: virtualAccount.source_deposit_instructions.bank_account_number,
          bankAddress: virtualAccount.source_deposit_instructions.bank_address,
          bankName: virtualAccount.source_deposit_instructions.bank_name,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "eur":
      return [
        {
          network: "SEPA",
          displayName: "SEPA",
          beneficiaryName: virtualAccount.source_deposit_instructions.account_holder_name,
          iban: virtualAccount.source_deposit_instructions.iban,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "mxn":
      return [
        {
          network: "SPEI",
          displayName: "SPEI",
          beneficiaryName: virtualAccount.source_deposit_instructions.account_holder_name,
          clabe: virtualAccount.source_deposit_instructions.clabe,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "gbp":
      return [
        {
          network: "FASTER_PAYMENTS",
          displayName: "Faster Payments",
          accountNumber: virtualAccount.source_deposit_instructions.account_number,
          sortCode: virtualAccount.source_deposit_instructions.sort_code,
          accountHolderName: virtualAccount.source_deposit_instructions.account_holder_name,
          bankName: virtualAccount.source_deposit_instructions.bank_name,
          bankAddress: virtualAccount.source_deposit_instructions.bank_address,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
  }
}

function getDepositDetailsFromLiquidationAddress(
  liquidationAddress: InferOutput<typeof LiquidationAddress>,
  account: string,
): InferOutput<typeof shared.DepositDetails>[] {
  if (liquidationAddress.destination_address.toLowerCase() !== account.toLowerCase()) {
    throw new Error(ErrorCodes.INVALID_ACCOUNT);
  }

  switch (liquidationAddress.chain) {
    case "tron":
      return [
        {
          network: "TRON",
          displayName: "TRON",
          address: liquidationAddress.address,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "solana":
      return [
        {
          network: "SOLANA",
          displayName: "SOLANA",
          address: liquidationAddress.address,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "stellar":
      return [
        {
          network: "STELLAR",
          displayName: "STELLAR",
          address: liquidationAddress.address,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
  }
  throw new Error(ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL);
}

function createReverseMapping<T extends Record<string, string>>(mapping: T) {
  return Object.fromEntries(Object.entries(mapping).map(([key, value]) => [value, key])) as Record<T[keyof T], keyof T>;
}
// #endregion utils

export const ErrorCodes = {
  ALREADY_ONBOARDED: "already onboarded",
  BAD_BRIDGE_ID: "bad bridge id",
  EMAIL_ALREADY_EXISTS: "email already exists",
  INVALID_ACCOUNT: "invalid destination account",
  INVALID_ADDRESS: "invalid address",
  NOT_ACTIVE_CUSTOMER: "not active customer",
  NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL: "not available crypto payment rail",
  NOT_AVAILABLE_CURRENCY: "not available currency",
  NOT_FOUND_IDENTIFICATION_CLASS: "not found identification class",
  NOT_SUPPORTED_CHAIN_ID: "not supported chain id",
  NO_COUNTRY_ALPHA3: "no country alpha3",
  NO_DOCUMENT: "no document",
  NO_DOCUMENT_FILE: "no document file",
  NO_PERSONA_ACCOUNT: "no persona account",
  NO_SOCIAL_SECURITY_NUMBER: "no social security number",
};

const BridgeApiErrorCodes = {
  EMAIL_ALREADY_EXISTS: "A customer with this email already exists",
  INVALID_PARAMETERS: "invalid_parameters",
  NOT_FOUND: "not_found",
} as const;
