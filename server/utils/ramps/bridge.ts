import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { captureException, captureMessage } from "@sentry/core";
import { eq } from "drizzle-orm";
import { alpha2ToAlpha3 } from "i18n-iso-countries";
import crypto from "node:crypto";
import {
  array,
  boolean,
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

import type { IdentificationClasses as PersonaIdentificationClasses } from "../persona";
import { getAccount, getDocument, getInquiry } from "../persona";
import type * as common from "./shared";
import database, { credentials } from "../../database";

if (!process.env.BRIDGE_API_URL) throw new Error("missing bridge api url");
const baseURL = process.env.BRIDGE_API_URL;

if (!process.env.BRIDGE_API_KEY) throw new Error("missing bridge api key");
const apiKey = process.env.BRIDGE_API_KEY;

// #region services
export async function createCustomer(user: InferInput<typeof CreateCustomer>) {
  return await request(NewCustomer, "/customers", {}, user, "POST").catch((error: unknown) => {
    if (error instanceof Error && error.message.includes(BridgeApiErrorCodes.EMAIL_ALREADY_EXISTS)) {
      captureMessage("email_already_exists", { contexts: { user }, level: "error" });
      throw new Error(ErrorCodes.EMAIL_ALREADY_EXISTS);
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
    if (error instanceof Error && error.message.includes(BridgeApiErrorCodes.NOT_FOUND)) return;
    throw error;
  });
}

export async function getQuote(
  from: (typeof QuoteCurrency)[number],
  to: (typeof QuoteCurrency)[number],
): Promise<InferOutput<typeof common.QuoteResponse>> {
  const quote = await request(Quote, `/exchange_rates?from=${CurrencyMapping[from]}&to=${CurrencyMapping[to]}`).catch(
    (error: unknown) => {
      captureException(error);
    },
  );
  if (!quote) return;
  return {
    buyRate: quote.buy_rate,
    sellRate: quote.sell_rate,
  };
}

export async function createVirtualAccount(customerId: string, data: InferInput<typeof CreateVirtualAccount>) {
  return await request(VirtualAccount, `/customers/${customerId}/virtual_accounts`, {}, data, "POST");
}

// TODO pagination
export async function getVirtualAccounts(customerId: string) {
  return await request(VirtualAccounts, `/customers/${customerId}/virtual_accounts`);
}

export async function createTransfer(data: InferInput<typeof CreateTransfer>) {
  return await request(Transfer, "/transfers", {}, data, "POST");
}

// TODO pagination
export async function getStaticTransferTemplates(customerId: string) {
  return await request(StaticTransferTemplates, `/customers/${customerId}/static_templates`);
}

export async function createLiquidationAddress(customerId: string, data: InferInput<typeof CreateLiquidationAddress>) {
  return await request(LiquidationAddress, `/customers/${customerId}/liquidation_addresses`, {}, data, "POST");
}

// TODO pagination
export async function getLiquidationAddresses(customerId: string) {
  return await request(LiquidationAddresses, `/customers/${customerId}/liquidation_addresses`);
}

interface GetProvider {
  credentialId: string;
  templateId: string;
  customerId?: string | null;
  countryCode?: string;
  redirectURL?: string;
}

export async function getProvider(data: GetProvider): Promise<InferOutput<typeof common.ProviderInfo>> {
  const currencies: (typeof SupportedCurrency)[number][] = [];
  const cryptoCurrencies: {
    cryptoCurrency: (typeof SupportedCrypto)[number];
    network: (typeof common.CryptoNetwork)[number];
  }[] = [];

  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof common.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("bridge_not_supported_chain_id", { contexts: { chain }, level: "error" });
    return { status: "NOT_AVAILABLE", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
  }

  for (const cryptoRail of SupportedCryptoPaymentRail) {
    for (const cryptoCurrency of CryptoCurrencyByPaymentRail[cryptoRail]) {
      cryptoCurrencies.push({ cryptoCurrency, network: CryptoPaymentRailMapping[cryptoRail] });
    }
  }

  const pendingTasks: InferOutput<typeof common.PendingTask>[] = [];
  if (data.customerId) {
    const bridgeUser = await getCustomer(data.customerId);
    if (!bridgeUser) throw new Error(ErrorCodes.BAD_BRIDGE_ID);
    switch (bridgeUser.status) {
      case "offboarded":
      case "rejected":
      case "paused":
        captureMessage("bridge_user_not_available", { contexts: { bridgeUser }, level: "warning" });
        return { status: "NOT_AVAILABLE", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
      case "under_review":
      case "awaiting_questionnaire":
      case "awaiting_ubo":
      case "incomplete":
      case "not_started":
        captureMessage("bridge_user_onboarding", { contexts: { bridgeUser }, level: "warning" });
        return { status: "ONBOARDING", currencies: [], cryptoCurrencies: [], pendingTasks: [] };
      case "active":
        break;
    }

    if (bridgeUser.future_requirements_due?.length) {
      // TODO handle future requirements
      captureMessage("bridge_future_requirements_due", { contexts: { bridgeUser }, level: "warning" });
    }

    if (bridgeUser.requirements_due?.length) {
      // TODO handle requirements due
      // ? external_account is only for off-ramp
      captureMessage("bridge_requirements_due", { contexts: { bridgeUser }, level: "warning" });
    }

    for (const endorsement of bridgeUser.endorsements) {
      if (endorsement.status !== "approved") {
        // TODO handle pending tasks
        captureMessage("endorsement_not_approved", { contexts: { bridgeUser }, level: "warning" });
        break;
      }

      currencies.push(...CurrencyByEndorsement[endorsement.name]);

      if (endorsement.additional_requirements?.length) {
        // TODO handle additional requirements
        captureMessage("additional_requirements", { contexts: { bridgeUser }, level: "warning" });
      }

      if (endorsement.requirements.missing) {
        captureMessage("requirements_missing", { contexts: { bridgeUser }, level: "warning" });
      }
    }

    return { status: "ACTIVE", currencies, cryptoCurrencies, pendingTasks };
  }

  const [inquiry, personaAccount] = await Promise.all([
    getInquiry(data.credentialId, data.templateId),
    getAccount(data.credentialId),
  ]);
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);
  if (!inquiry) throw new Error(ErrorCodes.NO_KYC);
  if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
    throw new Error(ErrorCodes.KYC_NOT_APPROVED);
  }
  const countryCode = personaAccount.attributes["country-code"];
  const identificationClass = inquiry.attributes.fields["identification-class"]?.value;
  if (!identificationClass) throw new Error(ErrorCodes.NO_IDENTIFICATION_CLASS);
  const bridgeIdType = idClassToBridge(identificationClass);
  if (!SupportedIdentificationTypes.includes(bridgeIdType as (typeof SupportedIdentificationTypes)[number])) {
    throw new Error(ErrorCodes.NOT_SUPPORTED_IDENTIFICATION_CLASS);
  }

  const postalCode = inquiry.attributes.fields["address-postal-code"]?.value;
  if (!postalCode) throw new Error(ErrorCodes.NO_POSTAL_CODE);
  const subdivision =
    inquiry.attributes.fields["address-subdivision"]?.value ?? personaAccount.attributes["address-subdivision"];
  if (!subdivision) throw new Error(ErrorCodes.NO_SUBDIVISION);
  const streetLine1 =
    inquiry.attributes.fields["address-street-1"]?.value ?? personaAccount.attributes["address-street-1"];
  if (!streetLine1) throw new Error(ErrorCodes.NO_ADDRESS);
  const city = inquiry.attributes.fields["address-city"]?.value ?? personaAccount.attributes["address-city"];
  if (!city) throw new Error(ErrorCodes.NO_CITY);
  const documentId = inquiry.attributes.fields["current-government-id"]?.value?.id;
  if (!documentId) throw new Error(ErrorCodes.NO_DOCUMENT_ID);

  if (!countryCode) throw new Error(ErrorCodes.NO_COUNTRY);
  const country = alpha2ToAlpha3(countryCode);
  if (!country) throw new Error(ErrorCodes.NO_COUNTRY_ALPHA3);

  if (countryCode === "US" && !personaAccount.attributes["social-security-number"]) {
    throw new Error(ErrorCodes.NO_SOCIAL_SECURITY_NUMBER);
  }

  const endorsements: (typeof Endorsements)[number][] = ["base", "sepa"];
  if (countryCode === "MX") {
    endorsements.push("spei");
  }
  if (countryCode === "BR") {
    endorsements.push("pix");
  }

  for (const endorsement of endorsements) {
    currencies.push(...CurrencyByEndorsement[endorsement]);
  }

  let bridgeRedirectURL: URL | undefined = undefined;
  if (data.redirectURL) {
    bridgeRedirectURL = new URL(data.redirectURL);
    bridgeRedirectURL.searchParams.set("provider", "bridge" satisfies (typeof common.RampProvider)[number]);
  }

  pendingTasks.push({
    type: "TOS_LINK",
    link: await agreementLink(bridgeRedirectURL?.toString()),
    displayText: "Terms of Service",
    currencies,
    cryptoCurrencies,
  });

  return { status: "NOT_STARTED", currencies: [], cryptoCurrencies: [], pendingTasks };
}

interface Onboarding {
  credentialId: string;
  customerId: string | null;
  templateId: string;
  acceptedTermsId: string;
}

export async function onboarding(data: Onboarding): Promise<void> {
  if (data.customerId) {
    // TODO handle pending tasks
    throw new Error(ErrorCodes.ALREADY_ONBOARDED);
  }

  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof common.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("bridge_not_supported_chain_id", { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  const [inquiry, personaAccount] = await Promise.all([
    getInquiry(data.credentialId, data.templateId),
    getAccount(data.credentialId),
  ]);
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);
  if (!inquiry) throw new Error(ErrorCodes.NO_KYC);
  if (inquiry.attributes.status !== "approved" && inquiry.attributes.status !== "completed") {
    throw new Error(ErrorCodes.KYC_NOT_APPROVED);
  }

  const countryCode = personaAccount.attributes["country-code"];
  if (!countryCode) throw new Error(ErrorCodes.NO_COUNTRY);
  const identificationClass = inquiry.attributes.fields["identification-class"]?.value;
  if (!identificationClass) throw new Error(ErrorCodes.NO_IDENTIFICATION_CLASS);
  const bridgeIdType = idClassToBridge(identificationClass);
  if (!bridgeIdType) throw new Error(ErrorCodes.NOT_FOUND_IDENTIFICATION_CLASS);
  if (!SupportedIdentificationTypes.includes(bridgeIdType as (typeof SupportedIdentificationTypes)[number])) {
    throw new Error(ErrorCodes.NOT_SUPPORTED_IDENTIFICATION_CLASS);
  }
  const identificationNumber = inquiry.attributes.fields["identification-number"]?.value;
  if (!identificationNumber) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);

  const endorsements: (typeof Endorsements)[number][] = ["base", "sepa"];

  if (countryCode === "MX") {
    endorsements.push("spei");
  }

  if (countryCode === "BR") {
    endorsements.push("pix");
  }

  const postalCode =
    inquiry.attributes.fields["address-postal-code"]?.value ?? personaAccount.attributes["address-postal-code"];
  if (!postalCode) throw new Error(ErrorCodes.NO_POSTAL_CODE);
  const subdivision =
    inquiry.attributes.fields["address-subdivision"]?.value ?? personaAccount.attributes["address-subdivision"];
  if (!subdivision) throw new Error(ErrorCodes.NO_SUBDIVISION);
  const streetLine1 =
    inquiry.attributes.fields["address-street-1"]?.value ?? personaAccount.attributes["address-street-1"];
  if (!streetLine1) throw new Error(ErrorCodes.NO_ADDRESS);
  const streetLine2 =
    inquiry.attributes.fields["address-street-2"]?.value ?? personaAccount.attributes["address-street-2"];
  const city = inquiry.attributes.fields["address-city"]?.value ?? personaAccount.attributes["address-city"];
  if (!city) throw new Error(ErrorCodes.NO_CITY);

  const country = alpha2ToAlpha3(countryCode);
  if (!country) throw new Error(ErrorCodes.NO_COUNTRY_ALPHA3);

  const documentId = inquiry.attributes.fields["current-government-id"]?.value?.id;
  if (!documentId) throw new Error(ErrorCodes.NO_DOCUMENT_ID);
  const identityDocument = await getDocument(documentId);
  const frontDocumentURL = identityDocument.attributes["front-photo"]?.url;
  const backDocumentURL = identityDocument.attributes["back-photo"]?.url;

  const [frontFileEncoded, backFileEncoded] = await Promise.all([
    frontDocumentURL
      ? fetchAndEncodeFile(frontDocumentURL, identityDocument.attributes["front-photo"]?.filename ?? "front-photo.jpg")
      : undefined,
    backDocumentURL
      ? fetchAndEncodeFile(backDocumentURL, identityDocument.attributes["back-photo"]?.filename ?? "back-photo.jpg")
      : undefined,
  ]);
  if (!frontFileEncoded) throw new Error(ErrorCodes.NO_DOCUMENT_FILE);

  const identifyingInformation: (InferInput<typeof IdentityDocument> | InferInput<typeof TIN>)[] = [
    {
      type: bridgeIdType,
      issuing_country: country,
      number: identificationNumber,
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
    first_name: inquiry.attributes["name-first"],
    last_name: inquiry.attributes["name-last"],
    email: inquiry.attributes["email-address"],
    phone: inquiry.attributes["phone-number"],
    residential_address: {
      street_line_1: streetLine1,
      street_line_2: streetLine2 ?? undefined,
      postal_code: postalCode,
      subdivision,
      country,
      city,
    },
    birth_date: inquiry.attributes.birthdate,
    signed_agreement_id: data.acceptedTermsId,
    endorsements,
    nationality: country,
    identifying_information: identifyingInformation,
  });

  // TODO handle user already onboarded

  await database.update(credentials).set({ bridgeId: customer.id }).where(eq(credentials.id, data.credentialId));
}

export async function getDepositDetails(
  currency: (typeof SupportedCurrency)[number],
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
): Promise<InferOutput<typeof common.DepositDetails>[]> {
  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof common.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("bridge_not_supported_chain_id", { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  if (customer.status !== "active") {
    throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);
  }
  const approvedEndorsements = customer.endorsements.filter((endorsement) => endorsement.status === "approved");
  const availableCurrencies = approvedEndorsements.flatMap((endorsement) => CurrencyByEndorsement[endorsement.name]);
  if (!availableCurrencies.includes(currency)) throw new Error(ErrorCodes.NOT_AVAILABLE_CURRENCY);
  const virtualAccounts = await getVirtualAccounts(customer.id);
  let virtualAccount = virtualAccounts.data.find(
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
  paymentRail: (typeof common.CryptoNetwork)[number],
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
): Promise<InferOutput<typeof common.DepositDetails>[]> {
  const supportedChainId = SupportedOnRampChainId[chain.id as (typeof common.SupportedChainId)[number]];
  if (!supportedChainId) {
    captureMessage("bridge_not_supported_chain_id", { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  if (customer.status !== "active") {
    throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);
  }

  const liquidationAddresses = await getLiquidationAddresses(customer.id);
  let liquidationAddress = liquidationAddresses.data.find(
    ({ chain: bridgeChain, currency }) =>
      CryptoPaymentRailMapping[bridgeChain as (typeof SupportedCryptoPaymentRail)[number]] === paymentRail &&
      currency === CryptocurrencyMapping[cryptoCurrency],
  );

  liquidationAddress ??= await createLiquidationAddress(customer.id, {
    destination_address: account,
    destination_currency: "usdc",
    destination_payment_rail: supportedChainId,
    currency: CryptocurrencyMapping[cryptoCurrency],
    chain: NetworkToCryptoPaymentRail[paymentRail],
  });

  return getDepositDetailsFromLiquidationAddress(liquidationAddress, account);
}
// #endregion services

// #region fiat currencies
const Endorsements = ["base", "sepa", "spei", "pix"] as const; // cspell:ignore spei, sepa
const BridgeCryptocurrency = ["usdc", "usdt"] as const;
const BridgeCurrency = ["eur", "usd", "mxn", "brl"] as const;

export const PaymentRail = ["ach_push", "pix", "sepa", "spei", "wire"] as const;
const VirtualAccountStatus = ["activated", "deactivated"] as const;

export const SupportedCurrency = [
  "EUR",
  "USD",
  "MXN",
  "BRL",
] as const satisfies readonly (typeof common.Currency)[number][];

export const QuoteCurrency = [
  "BRL",
  "USD",
  "EUR",
  "MXN",
] as const satisfies readonly (typeof SupportedCurrency)[number][];

const CurrencyMapping: Record<(typeof SupportedCurrency)[number], (typeof BridgeCurrency)[number]> = {
  EUR: "eur",
  USD: "usd",
  MXN: "mxn",
  BRL: "brl",
} as const;

const CurrencyByEndorsement: Record<(typeof Endorsements)[number], (typeof SupportedCurrency)[number][]> = {
  base: ["USD"],
  sepa: ["EUR"],
  spei: ["MXN"],
  pix: ["BRL"],
};
// #endregion fiat currencies

// #region crypto currencies
export const SupportedCrypto = ["USDT", "USDC"] as const satisfies readonly (typeof common.Cryptocurrency)[number][];

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

const CryptoPaymentRailMapping: Record<
  (typeof SupportedCryptoPaymentRail)[number],
  (typeof common.CryptoNetwork)[number]
> = {
  tron: "TRON",
  stellar: "STELLAR",
  solana: "SOLANA",
} as const;

const CryptoCurrencyByPaymentRail: Record<
  (typeof SupportedCryptoPaymentRail)[number],
  (typeof SupportedCrypto)[number][]
> = {
  tron: ["USDT"],
  solana: ["USDC"],
  stellar: ["USDC"],
  // avalanche_c_chain: [],
  // arbitrum: [],
  // ethereum: [],
  // optimism: [],
  // polygon: [],
  // base: [],
};

const NetworkToCryptoPaymentRail = createReverseMapping(CryptoPaymentRailMapping);
// #endregion crypto currencies

// #region schemas
const SupportedOnRampChainId: Record<
  (typeof common.SupportedChainId)[number],
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
] as const;

const SupportedIdentificationTypes = [
  "national_id",
  "passport",

  // TODO for testing, remove
  "drivers_license",
] as const satisfies readonly (typeof IdentityDocumentType)[number][];

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

export const DocumentType = [
  "proof_of_account_purpose",
  "proof_of_address",
  "proof_of_individual_name_change",
  "proof_of_relationship",
  "proof_of_source_of_funds",
  "proof_of_source_of_wealth",
  "proof_of_tax_identification",
  "other",
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

const TransferState = [
  "payment_processed",
  "payment_submitted",
  "awaiting_funds",
  "funds_received",
  "undeliverable",
  "in_review",
  "canceled",
  "refunded",
  "returned",
] as const;

const IdClassToBridge: Record<
  (typeof PersonaIdentificationClasses)[number],
  (typeof IdentityDocumentType)[number] | undefined
> = {
  id: "national_id",
  pp: "passport",
  dl: "drivers_license",
  wp: undefined,
  rp: undefined,
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

const Document = object({
  type: picklist(DocumentType),
  file: string(),
  description: optional(string()),
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
  documents: optional(array(Document)),

  // only for high risk populations
  account_purpose: optional(string()), // TODO only an enum, check
  account_purpose_other: optional(string()), // required if account_purpose is other
  employment_status: optional(string()), // TODO only an enum, check
  expected_monthly_payments_usd: optional(picklist(["0_4999", "5000_9999", "10000_49999", "50000_plus"])),
  acting_as_intermediary: optional(boolean()),
  most_recent_occupation: optional(string()),
  source_of_funds: optional(
    picklist([
      "company_funds",
      "ecommerce_reseller",
      "gambling_proceeds",
      "gifts",
      "government_benefits",
      "inheritance",
      "investments_loans",
      "pension_retirement",
      "salary",
      "sale_of_assets_real_estate",
      "savings",
      "someone_elses_funds",
    ]),
  ),
  verified_govid_at: optional(string()), // cspell:ignore verified_govid_at
  verified_selfie_at: optional(string()),
  completed_customer_safety_check_at: optional(string()),
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
  source_deposit_instructions: variant("payment_rail", [
    object({
      currency: literal("usd" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: optional(array(picklist(["ach_push", "wire"] as const satisfies (typeof PaymentRail)[number][]))),
      payment_rail: picklist(["ach_push", "wire"] as const satisfies (typeof PaymentRail)[number][]),
      bank_name: string(),
      bank_address: string(),
      bank_routing_number: string(),
      bank_account_number: string(),
      bank_beneficiary_name: string(),
      bank_beneficiary_address: string(),
    }),
    object({
      currency: literal("eur" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: optional(array(picklist(["sepa"] as const satisfies (typeof PaymentRail)[number][]))),
      payment_rail: picklist(["sepa"] as const satisfies (typeof PaymentRail)[number][]),
      bank_name: string(),
      bank_address: string(),
      account_holder_name: string(),
      iban: string(), // cspell:ignore iban
      bic: string(),
    }),
    object({
      currency: literal("mxn" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: optional(array(picklist(["spei"] as const satisfies (typeof PaymentRail)[number][]))),
      payment_rail: picklist(["spei"] as const satisfies (typeof PaymentRail)[number][]),
      account_holder_name: string(),
      clabe: string(), // cspell:ignore clabe
    }),
  ]),
  destination: object({
    address: string(),
  }),
});

const VirtualAccounts = object({ count: number(), data: array(VirtualAccount) });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateTransfer = object({
  id: optional(string()),
  client_reference_id: optional(string()),
  developer_fee_percentage: optional(string()),
  developer_fee: optional(string()),
  on_behalf_of: string(),
  source: object({
    currency: picklist([...BridgeCurrency, ...BridgeCryptocurrency]),
    payment_rail: picklist([...PaymentRail, ...CryptoPaymentRail]),
    external_account_id: optional(string()),
  }),
  destination: object({
    currency: picklist([...BridgeCurrency, ...BridgeCryptocurrency]),
    payment_rail: picklist([...PaymentRail, ...CryptoPaymentRail]),
    to_address: optional(string()),

    external_account_id: optional(string()),
    ach_reference: optional(string()),
    swift_charges: optional(picklist(["our", "sha"])),
    imad: optional(string()), // cspell:ignore imad
  }),
  features: object({
    flexible_amount: optional(boolean()),
    static_template: optional(boolean()),
    allow_any_from_address: optional(boolean()),
  }),
});

const Transfer = object({
  id: string(),
  state: picklist(TransferState),
  source_deposit_instructions: optional(
    object({
      payment_rail: optional(picklist([...PaymentRail, ...CryptoPaymentRail])),
      currency: optional(picklist([...BridgeCurrency, ...BridgeCryptocurrency])),
      to_address: optional(string()),
      blockchain_memo: optional(string()),

      deposit_message: optional(string()),
      bank_name: optional(string()),
      bank_address: optional(string()),
      bank_routing_number: optional(string()),
      bank_account_number: optional(string()),
      bank_beneficiary_name: optional(string()),
      bank_beneficiary_address: optional(string()),
      account_holder_name: optional(string()),
      iban: optional(string()), // cspell:ignore iban
      bic: optional(string()),
      clabe: optional(string()), // cspell:ignore clabe
    }),
  ),
  return_details: optional(object({ reason: optional(string()), refund_reference_id: optional(string()) })),
});

const StaticTransferTemplates = object({
  count: number(),
  data: array(Transfer),
});

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
  method: "GET" | "POST" | "PUT" | "PATCH" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const payload = {
    method,
    headers: {
      ...headers,
      "api-key": apiKey,
      ...(method === "POST" && { "Idempotency-Key": generateUUID() }),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  };
  const response = await fetch(`${baseURL}${url}`, payload);

  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return parse(schema, {});
  return parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}

function generateUUID() {
  return crypto.randomUUID();
}

async function encodeFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const type = file.type === "" ? "image/jpg" : file.type;
  return `data:${type};base64,${base64}`;
}

async function fetchAndEncodeFile(url: string, fileName: string): Promise<string> {
  const file = await fetch(url).then((document) => document.blob());
  return encodeFile(new File([file], fileName));
}

function idClassToBridge(idClass: string): (typeof IdentityDocumentType)[number] | undefined {
  return IdClassToBridge[idClass as keyof typeof IdClassToBridge];
}

function getDepositDetailsFromVirtualAccount(
  virtualAccount: InferOutput<typeof VirtualAccount>,
  account: string,
): InferOutput<typeof common.DepositDetails>[] {
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
  }
}

function getDepositDetailsFromLiquidationAddress(
  liquidationAddress: InferOutput<typeof LiquidationAddress>,
  account: string,
): InferOutput<typeof common.DepositDetails>[] {
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
  NOT_SUPPORTED_IDENTIFICATION_CLASS: "not supported identification class",
  NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL: "not available crypto payment rail",
  MULTIPLE_IDENTIFICATION_NUMBERS: "multiple identification numbers",
  NOT_FOUND_IDENTIFICATION_CLASS: "not found identification class",
  NO_SOCIAL_SECURITY_NUMBER: "no social security number",
  NO_IDENTIFICATION_NUMBER: "no identification number",
  NO_IDENTIFICATION_CLASS: "no identification class",
  MULTIPLE_IDENTIFICATION: "multiple identification",
  NOT_AVAILABLE_CURRENCY: "not available currency",
  NOT_SUPPORTED_CHAIN_ID: "not supported chain id",
  EMAIL_ALREADY_EXISTS: "email already exists",
  NOT_ACTIVE_CUSTOMER: "not active customer",
  MULTIPLE_DOCUMENTS: "multiple documents",
  NO_FIAT_CAPABILITY: "no fiat capability",
  NO_PERSONA_ACCOUNT: "no persona account",
  ALREADY_ONBOARDED: "already onboarded",
  NO_COUNTRY_ALPHA3: "no country alpha3",
  KYC_NOT_APPROVED: "kyc not approved",
  NO_DOCUMENT_FILE: "no document file",
  INVALID_ACCOUNT: "invalid destination account",
  NO_DOCUMENT_ID: "no document id",
  NO_POSTAL_CODE: "no postal code",
  NO_SUBDIVISION: "no subdivision",
  BAD_BRIDGE_ID: "bad bridge id",
  NO_DOCUMENT: "no document",
  NO_ADDRESS: "no address",
  NO_COUNTRY: "no country",
  NO_CITY: "no city",
  NO_KYC: "no kyc",
};

const BridgeApiErrorCodes = {
  NOT_FOUND: "not_found",
  EMAIL_ALREADY_EXISTS: "A customer with this email already exists",
} as const;
