import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { captureException, captureMessage } from "@sentry/core";
import { eq } from "drizzle-orm";
import { alpha2ToAlpha3 } from "i18n-iso-countries";
import crypto from "node:crypto";
import * as v from "valibot";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import type { IdentificationClasses as PersonaIdentificationClasses, Inquiry } from "../persona";
import { getAccount, getDocument, getInquiry } from "../persona";
import type * as common from "./shared";
import database, { credentials } from "../../database";

if (!process.env.BRIDGE_API_URL) throw new Error("missing BRIDGE api url");
const baseURL = process.env.BRIDGE_API_URL;

if (!process.env.BRIDGE_API_KEY) throw new Error("missing BRIDGE api key");
const apiKey = process.env.BRIDGE_API_KEY;

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
} as const;

// #region services
export async function createCustomer(user: v.InferInput<typeof CreateCustomer>) {
  return await request(NewCustomer, `/customers`, {}, user, "POST");
}

export async function updateCustomer(customerId: string, user: Partial<v.InferInput<typeof CreateCustomer>>) {
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
): Promise<v.InferOutput<typeof common.QuoteResponse>> {
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

export async function createVirtualAccount(customerId: string, data: v.InferInput<typeof CreateVirtualAccount>) {
  return await request(VirtualAccount, `/customers/${customerId}/virtual_accounts`, {}, data, "POST");
}

// TODO pagination
export async function getVirtualAccounts(customerId: string) {
  return await request(VirtualAccounts, `/customers/${customerId}/virtual_accounts`);
}

export async function createTransfer(data: v.InferInput<typeof CreateTransfer>) {
  return await request(Transfer, `/transfers`, {}, data, "POST");
}

// TODO pagination
export async function getStaticTransferTemplates(customerId: string) {
  return await request(StaticTransferTemplates, `/customers/${customerId}/static_templates`);
}

export async function createLiquidationAddress(
  customerId: string,
  data: v.InferInput<typeof CreateLiquidationAddress>,
) {
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

export async function getProvider(data: GetProvider): Promise<v.InferOutput<typeof common.ProviderInfo>> {
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

  const pendingTasks: v.InferOutput<typeof common.PendingTask>[] = [];
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

    if (bridgeUser.future_requirements_due) {
      // TODO handle future requirements
      captureMessage("bridge_future_requirements_due", { contexts: { bridgeUser }, level: "warning" });
    }

    if (bridgeUser.requirements_due) {
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
  const identificationNumbers = personaAccount.attributes["identification-numbers"];
  if (!identificationNumbers) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  if (Object.keys(identificationNumbers).length === 0) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  // TODO support multiple id classes
  delete identificationNumbers.ssn;
  if (Object.keys(identificationNumbers).length > 1) throw new Error(ErrorCodes.MULTIPLE_IDENTIFICATION_NUMBERS);
  const identification = Object.values(identificationNumbers)[0];
  if (!identification) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  if (!identification[0]) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  // TODO support multiple id documents
  if (identification.length > 1) throw new Error(ErrorCodes.MULTIPLE_IDENTIFICATION);
  const countryCode = identification[0]["issuing-country"];
  const identificationClass = identification[0]["identification-class"];
  if (!identificationClass) throw new Error(ErrorCodes.NO_IDENTIFICATION_CLASS);
  const identificationType: (typeof IdentityDocumentType)[number] | undefined = idClassToBridge(identificationClass);
  if (!SupportedIdentificationTypes.includes(identificationType as (typeof SupportedIdentificationTypes)[number])) {
    throw new Error(ErrorCodes.NOT_SUPPORTED_IDENTIFICATION_CLASS);
  }

  const postalCode =
    inquiry.attributes.fields.address_postal_code?.value ?? personaAccount.attributes["address-postal-code"];
  if (!postalCode) throw new Error(ErrorCodes.NO_POSTAL_CODE);
  const subdivision =
    inquiry.attributes.fields.address_subdivision?.value ?? personaAccount.attributes["address-subdivision"];
  if (!subdivision) throw new Error(ErrorCodes.NO_SUBDIVISION);
  const streetLine1 =
    inquiry.attributes.fields.address_street_1?.value ?? personaAccount.attributes["address-street-1"];
  if (!streetLine1) throw new Error(ErrorCodes.NO_ADDRESS);
  const city = inquiry.attributes.fields.address_city?.value ?? personaAccount.attributes["address-city"];
  if (!city) throw new Error(ErrorCodes.NO_CITY);

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

  pendingTasks.push({
    type: "TOS_LINK",
    link: await agreementLink(data.redirectURL),
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

  const identificationNumbers = personaAccount.attributes["identification-numbers"];
  if (!identificationNumbers) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  if (Object.keys(identificationNumbers).length === 0) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  // TODO support multiple id numbers
  delete identificationNumbers.ssn;
  if (Object.keys(identificationNumbers).length > 1) throw new Error(ErrorCodes.MULTIPLE_IDENTIFICATION_NUMBERS);
  const identification = Object.values(identificationNumbers)[0];
  if (!identification) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  if (!identification[0]) throw new Error(ErrorCodes.NO_IDENTIFICATION_NUMBER);
  // TODO support multiple id documents
  if (identification.length > 1) throw new Error(ErrorCodes.MULTIPLE_IDENTIFICATION);
  const countryCode = identification[0]["issuing-country"];
  const identificationClass = identification[0]["identification-class"];
  if (!identificationClass) throw new Error(ErrorCodes.NO_IDENTIFICATION_CLASS);
  const identificationType: (typeof IdentityDocumentType)[number] | undefined = idClassToBridge(identificationClass);
  if (!SupportedIdentificationTypes.includes(identificationType as (typeof SupportedIdentificationTypes)[number])) {
    throw new Error(ErrorCodes.NOT_SUPPORTED_IDENTIFICATION_CLASS);
  }
  if (!identificationType) throw new Error(ErrorCodes.NOT_FOUND_IDENTIFICATION_CLASS);
  const endorsements: (typeof Endorsements)[number][] = ["base", "sepa"];

  if (countryCode === "MX") {
    endorsements.push("spei");
  }

  if (countryCode === "BR") {
    endorsements.push("pix");
  }

  const postalCode =
    inquiry.attributes.fields.address_postal_code?.value ?? personaAccount.attributes["address-postal-code"];
  if (!postalCode) throw new Error(ErrorCodes.NO_POSTAL_CODE);
  const subdivision =
    inquiry.attributes.fields.address_subdivision?.value ?? personaAccount.attributes["address-subdivision"];
  if (!subdivision) throw new Error(ErrorCodes.NO_SUBDIVISION);
  const streetLine1 =
    inquiry.attributes.fields.address_street_1?.value ?? personaAccount.attributes["address-street-1"];
  if (!streetLine1) throw new Error(ErrorCodes.NO_ADDRESS);
  const streetLine2 =
    inquiry.attributes.fields.address_street_2?.value ?? personaAccount.attributes["address-street-2"];
  const city = inquiry.attributes.fields.address_city?.value ?? personaAccount.attributes["address-city"];
  if (!city) throw new Error(ErrorCodes.NO_CITY);

  const country = alpha2ToAlpha3(countryCode);
  if (!country) throw new Error(ErrorCodes.NO_COUNTRY_ALPHA3);

  const documentId = getDocumentId(inquiry);
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

  const identifyingInformation: (v.InferInput<typeof IdentityDocument> | v.InferInput<typeof TIN>)[] = [];
  identifyingInformation.push({
    type: identificationType,
    issuing_country: country,
    number: identification[0]["identification-number"],
    image_front: frontFileEncoded,
    image_back: backFileEncoded,
  });

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
  await database.update(credentials).set({ bridgeId: customer.id }).where(eq(credentials.id, data.credentialId));
}

export async function getDepositDetails(
  currency: (typeof SupportedCurrency)[number],
  account: string,
  customer: v.InferOutput<typeof CustomerResponse>,
): Promise<v.InferOutput<typeof common.DepositDetails>[]> {
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
  customer: v.InferOutput<typeof CustomerResponse>,
): Promise<v.InferOutput<typeof common.DepositDetails>[]> {
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

const Quote = v.object({
  midmarket_rate: v.string(), // cspell:ignore midmarket
  buy_rate: v.string(),
  sell_rate: v.string(),
});

const AgreementLinkResponse = v.object({
  url: v.string(),
});

const CustomerResponse = v.object({
  id: v.string(),
  status: v.picklist(CustomerStatus),
  capabilities: v.optional(
    v.object({
      payin_crypto: v.optional(v.picklist(CapabilitiesStatus)), // cspell:ignore payin_crypto
      payout_crypto: v.optional(v.picklist(CapabilitiesStatus)),
      payin_fiat: v.optional(v.picklist(CapabilitiesStatus)), // cspell:ignore payin_fiat
      payout_fiat: v.optional(v.picklist(CapabilitiesStatus)),
    }),
  ),
  rejection_reasons: v.optional(
    v.array(
      v.object({
        developer_reason: v.string(),
        reason: v.string(),
        created_at: v.string(),
      }),
    ),
  ),
  endorsements: v.array(
    v.object({
      name: v.picklist(Endorsements),
      status: v.picklist(EndorsementStatus),
      additional_requirements: v.optional(v.array(v.picklist(AdditionalRequirements))),
      requirements: v.object({
        complete: v.array(v.string()),
        pending: v.array(v.string()),
        missing: v.nullish(v.unknown()),
        issues: v.array(v.union([v.string(), v.unknown()])),
      }),
    }),
  ),
  future_requirements_due: v.optional(v.array(v.picklist(["id_verification"]))),
  requirements_due: v.optional(v.array(v.picklist(["id_verification", "external_account"]))),
});

const IdentityDocument = v.object({
  type: v.picklist(IdentityDocumentType),
  issuing_country: v.string(),
  number: v.string(),
  image_front: v.string(),
  image_back: v.optional(v.string()),
  expiration: v.optional(v.string()),
});

const TIN = v.object({
  type: v.picklist(TINType),
  number: v.string(),
  issuing_country: v.string(),
});

const Document = v.object({
  type: v.picklist(DocumentType),
  file: v.string(),
  description: v.optional(v.string()),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateCustomer = v.object({
  type: v.literal("individual"),
  first_name: v.string(),
  middle_name: v.optional(v.string()),
  last_name: v.string(),
  transliterated_first_name: v.optional(v.string()),
  transliterated_middle_name: v.optional(v.string()),
  transliterated_last_name: v.optional(v.string()),
  email: v.string(),
  phone: v.string(),
  residential_address: v.object({
    street_line_1: v.string(),
    street_line_2: v.optional(v.string()),
    city: v.string(),
    subdivision: v.optional(v.string()),
    postal_code: v.optional(v.string()),
    country: v.string(),
  }),
  transliterated_residential_address: v.optional(
    v.object({
      street_line_1: v.optional(v.string()),
      street_line_2: v.optional(v.string()),
      city: v.optional(v.string()),
      subdivision: v.optional(v.string()),
      postal_code: v.optional(v.string()),
      country: v.optional(v.string()),
    }),
  ),
  birth_date: v.string(),
  signed_agreement_id: v.string(),
  nationality: v.string(),

  identifying_information: v.array(v.union([IdentityDocument, TIN])),
  endorsements: v.optional(v.array(v.picklist(Endorsements))),
  documents: v.optional(v.array(Document)),

  // only for high risk populations
  account_purpose: v.optional(v.string()), // TODO only an enum, check
  account_purpose_other: v.optional(v.string()), // required if account_purpose is other
  employment_status: v.optional(v.string()), // TODO only an enum, check
  expected_monthly_payments_usd: v.optional(v.picklist(["0_4999", "5000_9999", "10000_49999", "50000_plus"])),
  acting_as_intermediary: v.optional(v.boolean()),
  most_recent_occupation: v.optional(v.string()),
  source_of_funds: v.optional(
    v.picklist([
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
  verified_govid_at: v.optional(v.string()), // cspell:ignore verified_govid_at
  verified_selfie_at: v.optional(v.string()),
  completed_customer_safety_check_at: v.optional(v.string()),
});

const NewCustomer = v.object({
  status: v.picklist(CustomerStatus),
  id: v.string(),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateVirtualAccount = v.object({
  developer_fee_percentage: v.optional(v.string()),
  source: v.object({
    currency: v.picklist(BridgeCurrency),
  }),
  destination: v.object({
    currency: v.picklist(BridgeCryptocurrency),
    payment_rail: v.picklist(CryptoPaymentRail),
    address: Address,
  }),
});

const VirtualAccount = v.object({
  id: v.string(),
  status: v.picklist(VirtualAccountStatus),
  developer_fee_percentage: v.optional(v.string()),
  source_deposit_instructions: v.variant("payment_rail", [
    v.object({
      currency: v.literal("usd" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: v.optional(
        v.array(v.picklist(["ach_push", "wire"] as const satisfies (typeof PaymentRail)[number][])),
      ),
      payment_rail: v.picklist(["ach_push", "wire"] as const satisfies (typeof PaymentRail)[number][]),
      bank_name: v.string(),
      bank_address: v.string(),
      bank_routing_number: v.string(),
      bank_account_number: v.string(),
      bank_beneficiary_name: v.string(),
      bank_beneficiary_address: v.string(),
    }),
    v.object({
      currency: v.literal("eur" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: v.optional(v.array(v.picklist(["sepa"] as const satisfies (typeof PaymentRail)[number][]))),
      payment_rail: v.picklist(["sepa"] as const satisfies (typeof PaymentRail)[number][]),
      bank_name: v.string(),
      bank_address: v.string(),
      account_holder_name: v.string(),
      iban: v.string(), // cspell:ignore iban
      bic: v.string(),
    }),
    v.object({
      currency: v.literal("mxn" as const satisfies (typeof BridgeCurrency)[number]),
      payment_rails: v.optional(v.array(v.picklist(["spei"] as const satisfies (typeof PaymentRail)[number][]))),
      payment_rail: v.picklist(["spei"] as const satisfies (typeof PaymentRail)[number][]),
      account_holder_name: v.string(),
      clabe: v.string(), // cspell:ignore clabe
    }),
  ]),
  destination: v.object({
    address: v.string(),
  }),
});

const VirtualAccounts = v.object({
  count: v.number(),
  data: v.array(VirtualAccount),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateTransfer = v.object({
  id: v.optional(v.string()),
  client_reference_id: v.optional(v.string()),
  developer_fee_percentage: v.optional(v.string()),
  developer_fee: v.optional(v.string()),
  on_behalf_of: v.string(),
  source: v.object({
    currency: v.picklist([...BridgeCurrency, ...BridgeCryptocurrency]),
    payment_rail: v.picklist([...PaymentRail, ...CryptoPaymentRail]),
    external_account_id: v.optional(v.string()),
  }),
  destination: v.object({
    currency: v.picklist([...BridgeCurrency, ...BridgeCryptocurrency]),
    payment_rail: v.picklist([...PaymentRail, ...CryptoPaymentRail]),
    to_address: v.optional(v.string()),

    external_account_id: v.optional(v.string()),
    ach_reference: v.optional(v.string()),
    swift_charges: v.optional(v.picklist(["our", "sha"])),
    imad: v.optional(v.string()), // cspell:ignore imad
  }),
  features: v.object({
    flexible_amount: v.optional(v.boolean()),
    static_template: v.optional(v.boolean()),
    allow_any_from_address: v.optional(v.boolean()),
  }),
});

const Transfer = v.object({
  id: v.string(),
  state: v.picklist(TransferState),
  source_deposit_instructions: v.optional(
    v.object({
      payment_rail: v.optional(v.picklist([...PaymentRail, ...CryptoPaymentRail])),
      currency: v.optional(v.picklist([...BridgeCurrency, ...BridgeCryptocurrency])),
      to_address: v.optional(v.string()),
      blockchain_memo: v.optional(v.string()),

      deposit_message: v.optional(v.string()),
      bank_name: v.optional(v.string()),
      bank_address: v.optional(v.string()),
      bank_routing_number: v.optional(v.string()),
      bank_account_number: v.optional(v.string()),
      bank_beneficiary_name: v.optional(v.string()),
      bank_beneficiary_address: v.optional(v.string()),
      account_holder_name: v.optional(v.string()),
      iban: v.optional(v.string()), // cspell:ignore iban
      bic: v.optional(v.string()),
      clabe: v.optional(v.string()), // cspell:ignore clabe
    }),
  ),
  return_details: v.optional(
    v.object({
      reason: v.optional(v.string()),
      refund_reference_id: v.optional(v.string()),
    }),
  ),
});

const StaticTransferTemplates = v.object({
  count: v.number(),
  data: v.array(Transfer),
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateLiquidationAddress = v.object({
  currency: v.picklist([...BridgeCryptocurrency, "any"]),
  chain: v.picklist([...CryptoPaymentRail, "evm"]),
  destination_payment_rail: v.picklist([...PaymentRail, ...CryptoPaymentRail]),
  destination_currency: v.picklist([...BridgeCurrency, ...BridgeCryptocurrency]),
  destination_address: Address,
});

const LiquidationAddress = v.object({
  id: v.string(),
  currency: v.picklist([...BridgeCryptocurrency, "any"]),
  chain: v.picklist([...CryptoPaymentRail, "evm"]),
  address: v.string(),
  destination_address: v.string(),
});

const LiquidationAddresses = v.object({
  count: v.number(),
  data: v.array(LiquidationAddress),
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
  if (rawBody.byteLength === 0) return v.parse(schema, {});
  return v.parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
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

export function getDocumentId(inquiry: v.InferOutput<typeof Inquiry>) {
  const documents = inquiry.relationships.documents?.data;
  if (!documents) throw new Error(ErrorCodes.NO_DOCUMENT);
  if (!documents[0]) throw new Error(ErrorCodes.NO_DOCUMENT);
  if (documents.length > 1) throw new Error(ErrorCodes.MULTIPLE_DOCUMENTS);
  const documentId = documents[0].id;
  if (!documentId) throw new Error(ErrorCodes.NO_DOCUMENT_ID);
  return documentId;
}

function getDepositDetailsFromVirtualAccount(
  virtualAccount: v.InferOutput<typeof VirtualAccount>,
  account: string,
): v.InferOutput<typeof common.DepositDetails>[] {
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
  liquidationAddress: v.InferOutput<typeof LiquidationAddress>,
  account: string,
): v.InferOutput<typeof common.DepositDetails>[] {
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
