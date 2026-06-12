import { captureException, setContext, withScope } from "@sentry/core";
import { eq } from "drizzle-orm";
import { alpha2ToAlpha3 } from "i18n-iso-countries";
import crypto from "node:crypto";
import {
  array,
  boolean,
  check,
  flatten,
  length,
  literal,
  maxLength,
  minLength,
  nullish,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  regex,
  safeParse,
  string,
  union,
  unknown,
  url as urlValidator,
  ValiError,
  variant,
  type BaseIssue,
  type BaseSchema,
  type InferInput,
  type InferOutput,
} from "valibot";
import { withRetry } from "viem";
import { optimism, optimismSepolia } from "viem/chains";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../../database";
import * as persona from "../persona";
import ServiceError from "../ServiceError";

export const name = "bridge" as const;

export const EVMNetwork = ["BASE"] as const;
export const Network = [...EVMNetwork, "SOLANA", "STELLAR", "TRON"] as const;
export const OfframpNetwork = ["BASE", "SOLANA", "STELLAR", "TRON"];

if (!process.env.BRIDGE_API_URL) throw new Error("missing bridge api url");
const baseURL = process.env.BRIDGE_API_URL;

if (!process.env.BRIDGE_API_KEY) throw new Error("missing bridge api key");
const apiKey = process.env.BRIDGE_API_KEY;

export function createCustomer(user: InferInput<typeof CreateCustomer>, idempotencyKey?: string) {
  return request(NewCustomer, "/customers", {}, user, "POST", 15_000, idempotencyKey).catch((error: unknown) => {
    if (error instanceof ServiceError && typeof error.cause === "string") {
      if (error.cause.includes(BridgeApiErrorCodes.EMAIL_ALREADY_EXISTS)) {
        withScope((scope) => {
          scope.addEventProcessor((event) => {
            if (event.exception?.values?.[0]) event.exception.values[0].type = "email already exists";
            return event;
          });
          captureException(error, {
            level: "error",
            fingerprint: ["{{ default }}", "email already exists"],
          });
        });
        throw new Error(ErrorCodes.EMAIL_ALREADY_EXISTS);
      }
      if (error.cause.includes(BridgeApiErrorCodes.INVALID_PARAMETERS) && error.cause.includes("residential_address")) {
        withScope((scope) => {
          scope.addEventProcessor((event) => {
            if (event.exception?.values?.[0]) event.exception.values[0].type = "invalid address";
            return event;
          });
          captureException(error, {
            level: "warning",
            fingerprint: ["{{ default }}", "invalid address"],
          });
        });
        throw new Error(ErrorCodes.INVALID_ADDRESS);
      }
    }
    throw error;
  });
}

export async function updateCustomer(customerId: string, user: Partial<InferInput<typeof CreateCustomer>>) {
  return await request(NewCustomer, `/customers/${customerId}`, {}, user, "PUT");
}

export async function agreementLink(redirectUri?: string) {
  const response = await request(AgreementLinkResponse, `/customers/tos_links`, {}, undefined, "POST");
  const url = new URL(response.url);
  if (redirectUri) url.searchParams.set("redirect_uri", redirectUri);
  return String(url);
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

export async function getQuote(from: "USD", to: (typeof QuoteCurrency)[number]) {
  if (["USDC", "USD"].includes(to)) return { buyRate: "1.0", sellRate: "1.0" };
  const quote = await request(Quote, `/exchange_rates?from=${CurrencyToBridge[from]}&to=${CurrencyToBridge[to]}`).catch(
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
  if (first.data.length < first.count)
    captureException(new Error("bridge virtual accounts pagination"), {
      level: "warning",
      contexts: { bridge: { customerId, count: first.count } },
    });
  while (all.length < first.count) {
    const last = all.at(-1);
    if (!last) break;
    const page = await request(VirtualAccounts, `${path}?limit=20&starting_after=${last.id}`);
    if (page.data.length === 0) {
      captureException(new Error("bridge virtual accounts empty page"), {
        level: "warning",
        contexts: { bridge: { customerId, count: first.count, fetched: all.length } },
      });
      break;
    }
    all.push(...page.data);
  }
  return all;
}

export async function createLiquidationAddress(customerId: string, data: InferInput<typeof CreateLiquidationAddress>) {
  return await request(LiquidationAddress, `/customers/${customerId}/liquidation_addresses`, {}, data, "POST");
}

export async function getLiquidationAddresses(customerId: string) {
  const path = `/customers/${customerId}/liquidation_addresses` as const;
  const first = await request(LiquidationAddresses, `${path}?limit=20`);
  const all = [...first.data];
  if (first.data.length < first.count)
    captureException(new Error("bridge liquidation addresses pagination"), {
      level: "warning",
      contexts: { bridge: { customerId, count: first.count } },
    });
  while (all.length < first.count) {
    const last = all.at(-1);
    if (!last) break;
    const page = await request(LiquidationAddresses, `${path}?limit=20&starting_after=${last.id}`);
    if (page.data.length === 0) {
      captureException(new Error("bridge liquidation addresses empty page"), {
        level: "warning",
        contexts: { bridge: { customerId, count: first.count, fetched: all.length } },
      });
      break;
    }
    all.push(...page.data);
  }
  return all;
}

export async function createTransfer(data: InferInput<typeof CreateTransfer>, idempotencyKey?: string) {
  return await request(Transfer, "/transfers", {}, data, "POST", 15_000, idempotencyKey);
}

export async function getTransfers(customerId: string) {
  return await request(Transfers, `/customers/${customerId}/transfers`, {}, undefined, "GET");
}

export async function getStaticTemplates(customerId: string) {
  const path = `/customers/${customerId}/transfers/static_templates` as const;
  const first = await request(StaticTemplates, `${path}?limit=50`);
  const all = [...first.data];
  if (first.data.length < first.count)
    captureException(new Error("bridge static templates pagination"), {
      level: "warning",
      contexts: { bridge: { customerId, count: first.count } },
    });
  while (all.length < first.count) {
    const last = all.at(-1);
    if (!last) break;
    const page = await request(StaticTemplates, `${path}?limit=50&starting_after=${last.id}`);
    if (page.data.length === 0) {
      captureException(new Error("bridge static templates empty page"), {
        level: "warning",
        contexts: { bridge: { customerId, count: first.count, fetched: all.length } },
      });
      break;
    }
    all.push(...page.data);
  }
  return all;
}

export function getKYCLink(customerId: string, redirectUri?: string, endorsement?: (typeof Endorsements)[number]) {
  const params = new URLSearchParams();
  if (endorsement) params.set("endorsement", endorsement);
  if (redirectUri) params.set("redirect_uri", redirectUri);
  return request(
    object({ url: pipe(string(), urlValidator()) }),
    `/customers/${customerId}/kyc_link${String(params) ? `?${String(params)}` : ""}`,
  ).then((result) => result.url);
}

export async function createExternalAccount(
  customer: InferOutput<typeof CustomerResponse>,
  externalAccount: InferInput<typeof ExternalAccountInput>,
) {
  const approved = customer.endorsements.some(
    (endorsement) =>
      endorsement.status === "approved" && CurrencyByEndorsement[endorsement.name].includes(externalAccount.currency),
  );
  if (!approved) throw new Error(ErrorCodes.NO_ENDORSEMENT);
  return await request(
    BridgeExternalAccount,
    `/customers/${customer.id}/external_accounts`,
    {},
    ((): InferInput<typeof BridgeCreateExternalAccount> => {
      switch (externalAccount.currency) {
        case "USD":
          return {
            account_type: "us",
            currency: "usd",
            account_owner_name: externalAccount.accountOwnerName,
            bank_name: externalAccount.bankName,
            account: {
              account_number: externalAccount.accountNumber,
              routing_number: externalAccount.routingNumber,
              checking_or_savings: externalAccount.checkingOrSavings,
            },
            address: {
              city: externalAccount.address.city,
              country: externalAccount.address.country,
              street_line_1: externalAccount.address.streetLine1,
              street_line_2: externalAccount.address.streetLine2,
              state: externalAccount.address.state,
              postal_code: externalAccount.address.postalCode,
            },
          };
        case "EUR":
          return externalAccount.accountOwnerType === "individual"
            ? {
                account_type: "iban",
                address: externalAccount.address
                  ? {
                      city: externalAccount.address.city,
                      country: externalAccount.address.country,
                      street_line_1: externalAccount.address.streetLine1,
                      street_line_2: externalAccount.address.streetLine2,
                      state: externalAccount.address.state,
                      postal_code: externalAccount.address.postalCode,
                    }
                  : undefined,
                currency: "eur",
                account_owner_name: externalAccount.accountOwnerName,
                account_owner_type: "individual",
                first_name: externalAccount.firstName,
                last_name: externalAccount.lastName,
                bank_name: externalAccount.bankName,
                iban: {
                  account_number: externalAccount.accountNumber,
                  bic: externalAccount.bic,
                  country: externalAccount.country,
                },
              }
            : {
                account_type: "iban",
                address: externalAccount.address
                  ? {
                      city: externalAccount.address.city,
                      country: externalAccount.address.country,
                      street_line_1: externalAccount.address.streetLine1,
                      street_line_2: externalAccount.address.streetLine2,
                      state: externalAccount.address.state,
                      postal_code: externalAccount.address.postalCode,
                    }
                  : undefined,
                currency: "eur",
                account_owner_name: externalAccount.accountOwnerName,
                account_owner_type: "business",
                business_name: externalAccount.businessName,
                bank_name: externalAccount.bankName,
                iban: {
                  account_number: externalAccount.accountNumber,
                  bic: externalAccount.bic,
                  country: externalAccount.country,
                },
              };
        case "MXN":
          return {
            account_type: "clabe",
            address: externalAccount.address
              ? {
                  city: externalAccount.address.city,
                  country: externalAccount.address.country,
                  street_line_1: externalAccount.address.streetLine1,
                  street_line_2: externalAccount.address.streetLine2,
                  state: externalAccount.address.state,
                  postal_code: externalAccount.address.postalCode,
                }
              : undefined,
            currency: "mxn",
            account_owner_name: externalAccount.accountOwnerName,
            bank_name: externalAccount.bankName,
            clabe: { account_number: externalAccount.clabe },
          };
        case "BRL":
          return "pixKey" in externalAccount.account
            ? {
                account_type: "pix",
                address: externalAccount.address
                  ? {
                      city: externalAccount.address.city,
                      country: externalAccount.address.country,
                      street_line_1: externalAccount.address.streetLine1,
                      street_line_2: externalAccount.address.streetLine2,
                      state: externalAccount.address.state,
                      postal_code: externalAccount.address.postalCode,
                    }
                  : undefined,
                currency: "brl",
                account_owner_name: externalAccount.accountOwnerName,
                bank_name: externalAccount.bankName,
                pix_key: {
                  pix_key: externalAccount.account.pixKey,
                  document_number: externalAccount.account.documentNumber,
                },
              }
            : {
                account_type: "pix",
                address: externalAccount.address
                  ? {
                      city: externalAccount.address.city,
                      country: externalAccount.address.country,
                      street_line_1: externalAccount.address.streetLine1,
                      street_line_2: externalAccount.address.streetLine2,
                      state: externalAccount.address.state,
                      postal_code: externalAccount.address.postalCode,
                    }
                  : undefined,
                currency: "brl",
                account_owner_name: externalAccount.accountOwnerName,
                bank_name: externalAccount.bankName,
                br_code: {
                  br_code: externalAccount.account.brCode,
                  document_number: externalAccount.account.documentNumber,
                },
              };
        case "GBP":
          if (!("accountOwnerType" in externalAccount)) {
            return {
              account_type: "gb",
              address: externalAccount.address
                ? {
                    city: externalAccount.address.city,
                    country: externalAccount.address.country,
                    street_line_1: externalAccount.address.streetLine1,
                    street_line_2: externalAccount.address.streetLine2,
                    state: externalAccount.address.state,
                    postal_code: externalAccount.address.postalCode,
                  }
                : undefined,
              currency: "gbp",
              account_owner_name: externalAccount.accountOwnerName,
              bank_name: externalAccount.bankName,
              account: { account_number: externalAccount.accountNumber, sort_code: externalAccount.sortCode },
            };
          }
          return externalAccount.accountOwnerType === "individual"
            ? {
                account_type: "gb",
                address: externalAccount.address
                  ? {
                      city: externalAccount.address.city,
                      country: externalAccount.address.country,
                      street_line_1: externalAccount.address.streetLine1,
                      street_line_2: externalAccount.address.streetLine2,
                      state: externalAccount.address.state,
                      postal_code: externalAccount.address.postalCode,
                    }
                  : undefined,
                currency: "gbp",
                account_owner_name: externalAccount.accountOwnerName,
                account_owner_type: "individual",
                first_name: externalAccount.firstName,
                last_name: externalAccount.lastName,
                bank_name: externalAccount.bankName,
                account: { account_number: externalAccount.accountNumber, sort_code: externalAccount.sortCode },
              }
            : {
                account_type: "gb",
                address: externalAccount.address
                  ? {
                      city: externalAccount.address.city,
                      country: externalAccount.address.country,
                      street_line_1: externalAccount.address.streetLine1,
                      street_line_2: externalAccount.address.streetLine2,
                      state: externalAccount.address.state,
                      postal_code: externalAccount.address.postalCode,
                    }
                  : undefined,
                currency: "gbp",
                account_owner_name: externalAccount.accountOwnerName,
                account_owner_type: "business",
                business_name: externalAccount.businessName,
                bank_name: externalAccount.bankName,
                account: { account_number: externalAccount.accountNumber, sort_code: externalAccount.sortCode },
              };
      }
    })(),
    "POST",
  ).then(
    ({ beneficiary_address_valid, bank_name, currency, id, account_owner_name }) =>
      ({
        addressValid: beneficiary_address_valid,
        bankName: bank_name,
        currency: parse(picklist(FiatCurrency), FiatByBridgeCurrency[currency]),
        id,
        ownerName: account_owner_name,
      }) satisfies InferOutput<typeof ExternalAccount>,
  );
}

export function updateExternalAccount(
  customer: InferOutput<typeof CustomerResponse>,
  externalAccountId: string,
  update: InferInput<typeof UpdateExternalAccountInput>,
) {
  return request(
    BridgeExternalAccount,
    `/customers/${customer.id}/external_accounts/${externalAccountId}`,
    {},
    {
      address: update.address && {
        street_line_1: update.address.streetLine1,
        street_line_2: update.address.streetLine2,
        city: update.address.city,
        state: update.address.state,
        postal_code: update.address.postalCode,
        country: update.address.country,
      },
      account: update.account && {
        checking_or_savings: update.account.checkingOrSavings,
        routing_number: update.account.routingNumber,
      },
    } satisfies InferInput<typeof BridgeUpdateExternalAccount>,
    "PUT",
  )
    .catch((error: unknown) => {
      if (
        error instanceof ServiceError &&
        typeof error.cause === "string" &&
        error.cause.includes(BridgeApiErrorCodes.NOT_FOUND)
      ) {
        throw new Error(ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND);
      }
      throw error;
    })
    .then(
      (externalAccount) =>
        ({
          addressValid: externalAccount.beneficiary_address_valid,
          bankName: externalAccount.bank_name,
          currency: parse(picklist(FiatCurrency), FiatByBridgeCurrency[externalAccount.currency]),
          id: externalAccount.id,
          ownerName: externalAccount.account_owner_name,
        }) satisfies InferOutput<typeof ExternalAccount>,
    );
}

export async function getExternalAccount(customerId: string, externalAccountId: string) {
  return await request(BridgeExternalAccount, `/customers/${customerId}/external_accounts/${externalAccountId}`).catch(
    (error: unknown) => {
      if (
        error instanceof ServiceError &&
        typeof error.cause === "string" &&
        error.cause.includes(BridgeApiErrorCodes.NOT_FOUND)
      ) {
        return;
      }
      throw error;
    },
  );
}

export async function listExternalAccounts(customerId: string) {
  const path = `/customers/${customerId}/external_accounts` as const;
  const first = await request(ExternalAccounts, `${path}?limit=20`);
  const accounts = [...first.data];
  if (first.data.length < first.count)
    captureException(new Error("bridge external accounts pagination"), {
      level: "warning",
      contexts: { bridge: { customerId, count: first.count } },
    });
  while (accounts.length < first.count) {
    const last = accounts.at(-1);
    if (!last) break;
    const page = await request(ExternalAccounts, `${path}?limit=20&starting_after=${last.id}`);
    if (page.data.length === 0) {
      captureException(new Error("bridge external accounts empty page"), {
        level: "warning",
        contexts: { bridge: { customerId, count: first.count, fetched: accounts.length } },
      });
      break;
    }
    accounts.push(...page.data);
  }
  return accounts.flatMap((account) => {
    const currency = FiatByBridgeCurrency[account.currency];
    if (!currency) return [];
    if (!account.active) return [];
    return [
      {
        addressValid: account.beneficiary_address_valid,
        bankName: account.bank_name,
        currency,
        id: account.id,
        ownerName: account.account_owner_name,
      } satisfies InferOutput<typeof ExternalAccount>,
    ];
  });
}

export async function getProvider(params: {
  countryCode?: string;
  credentialId: string;
  customerId?: null | string;
  redirectURL?: string;
}) {
  if (!Supported[chain.id]) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    return { onramp: { currencies: [] }, offramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
  }

  const currencies = {
    onramp: [
      ...EVMNetwork.map((network) => ({ currency: "USDC" as const, network })),
      { currency: "USDC" as const, network: "SOLANA" as const },
      { currency: "USDC" as const, network: "STELLAR" as const },
      { currency: "USDT" as const, network: "TRON" as const },
    ],
    offramp: [
      { currency: "USDC" as const, network: "BASE" as const },
      { currency: "USDC" as const, network: "SOLANA" as const },
      { currency: "USDC" as const, network: "STELLAR" as const },
      { currency: "USDT" as const, network: "TRON" as const },
    ],
  };

  if (params.customerId) {
    const bridgeUser = await getCustomer(params.customerId);
    if (!bridgeUser) throw new Error(ErrorCodes.BAD_BRIDGE_ID);
    switch (bridgeUser.status) {
      case "offboarded":
        captureException(new Error("bridge user not available"), { contexts: { bridgeUser }, level: "warning" });
        return { status: "NOT_AVAILABLE" as const, onramp: { currencies: [] }, offramp: { currencies: [] } };
      case "paused":
      case "rejected":
      case "under_review":
      case "awaiting_questionnaire":
      case "awaiting_ubo":
      case "incomplete":
      case "not_started":
        captureException(new Error("bridge user onboarding"), { contexts: { bridgeUser }, level: "warning" });
        return {
          status: "ONBOARDING" as const,
          onramp: {
            currencies: [...currencies.onramp, ...CurrencyByEndorsement.base],
          },
          offramp: {
            currencies: [...currencies.offramp, ...CurrencyByEndorsement.base],
          },
          kycLink: await maybeKYCLink(
            bridgeUser,
            (() => {
              if (!params.redirectURL) return;
              const redirect = new URL(params.redirectURL);
              redirect.searchParams.set("provider", "bridge");
              return String(redirect);
            })(),
          ),
        };
      case "active":
        break;
    }

    const approvedCurrencies = bridgeUser.endorsements.flatMap((endorsement) => {
      if (endorsement.status !== "approved") {
        // TODO handle pending tasks
        captureException(new Error("endorsement not approved"), {
          contexts: { bridge: { bridgeId: params.customerId, endorsement } },
          level: "warning",
        });
        return [];
      }

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

      return CurrencyByEndorsement[endorsement.name];
    });

    return {
      status: "ACTIVE" as const,
      onramp: { currencies: [...currencies.onramp, ...approvedCurrencies] },
      offramp: { currencies: [...currencies.offramp, ...approvedCurrencies] },
      futureKYCLink: await futureKYCLink(
        bridgeUser,
        (() => {
          if (!params.redirectURL) return;
          const redirect = new URL(params.redirectURL);
          redirect.searchParams.set("provider", "bridge");
          return String(redirect);
        })(),
      ),
    };
  }

  const personaAccount = await persona.getAccount(params.credentialId, "bridge");
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);

  const countryCode = personaAccount.attributes["country-code"];
  if (Denylist.has(countryCode)) {
    return { onramp: { currencies: [] }, offramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
  }
  if (personaAccount.attributes.fields.bridge_enable?.value !== true) {
    return {
      status: "ONBOARDING" as const,
      onramp: { currencies: [...currencies.onramp, ...CurrencyByEndorsement.base] },
      offramp: { currencies: [...currencies.offramp, ...CurrencyByEndorsement.base] },
    };
  }
  const validDocument = persona.getDocumentForBridge(personaAccount.attributes.fields.documents.value);
  if (!validDocument) throw new Error(ErrorCodes.NO_DOCUMENT);
  const idClass = safeParse(picklist(persona.IdentificationClasses), validDocument.id_class.value);
  const bridgeIdType = idClass.success && persona.IdClassToBridge[idClass.output];
  if (!bridgeIdType) {
    captureException(new Error("bridge not found identification class"), {
      contexts: { bridge: { credentialId: params.credentialId, idClass: validDocument.id_class.value } },
      level: "warning",
    });
    return { onramp: { currencies: [] }, offramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
  }

  const country = alpha2ToAlpha3(countryCode);
  if (!country) throw new Error(ErrorCodes.NO_COUNTRY_ALPHA3);

  if (countryCode === "US" && !personaAccount.attributes["social-security-number"]) {
    throw new Error(ErrorCodes.NO_SOCIAL_SECURITY_NUMBER);
  }

  const endorsements = [
    "base" as const,
    "sepa" as const,
    ...(countryCode === "MX" ? ["spei" as const] : []),
    ...(countryCode === "BR" ? ["pix" as const] : []),
    ...(countryCode === "GB" ? ["faster_payments" as const] : []),
  ];

  return {
    status: "NOT_STARTED" as const,
    tosLink: await agreementLink(
      (() => {
        if (!params.redirectURL) return;
        const redirect = new URL(params.redirectURL);
        redirect.searchParams.set("provider", "bridge");
        return String(redirect);
      })(),
    ),
    onramp: {
      currencies: [...currencies.onramp, ...endorsements.flatMap((endorsement) => CurrencyByEndorsement[endorsement])],
    },
    offramp: {
      currencies: [...currencies.offramp, ...endorsements.flatMap((endorsement) => CurrencyByEndorsement[endorsement])],
    },
  };
}

export async function onboarding(params: { acceptedTermsId: string; credentialId: string; customerId: null | string }) {
  if (params.customerId) throw new Error(ErrorCodes.ALREADY_ONBOARDED);

  if (!Supported[chain.id]) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  const personaAccount = await persona.getAccount(params.credentialId, "bridge");
  if (!personaAccount) throw new Error(ErrorCodes.NO_PERSONA_ACCOUNT);

  const countryCode = personaAccount.attributes["country-code"];
  if (Denylist.has(countryCode)) {
    captureException(new Error("bridge denylisted country"), {
      contexts: { bridge: { credentialId: params.credentialId, countryCode } },
      level: "warning",
    });
    throw new Error(ErrorCodes.DENYLISTED_COUNTRY);
  }

  if (personaAccount.attributes.fields.bridge_enable?.value !== true) {
    captureException(new Error("bridge not enabled"), {
      contexts: { bridge: { credentialId: params.credentialId } },
      level: "warning",
    });
    throw new Error(ErrorCodes.NOT_ENABLED);
  }

  const validDocument = persona.getDocumentForBridge(personaAccount.attributes.fields.documents.value);
  if (!validDocument) throw new Error(ErrorCodes.NO_DOCUMENT);

  const endorsements: (typeof Endorsements)[number][] = ["base", "sepa"];
  if (countryCode === "MX") endorsements.push("spei");
  if (countryCode === "BR") endorsements.push("pix");
  if (countryCode === "GB") endorsements.push("faster_payments");

  const identityDocument = await persona.getDocument(validDocument.id_document_id.value);
  const frontDocumentURL = identityDocument.attributes["front-photo"]?.url;
  if (!frontDocumentURL) throw new Error(ErrorCodes.NO_DOCUMENT_FILE);
  const backDocumentURL = identityDocument.attributes["back-photo"]?.url;

  const [frontFileEncoded, backFileEncoded] = await Promise.all([
    fetchAndEncodeFile(frontDocumentURL, identityDocument.attributes["front-photo"]?.filename ?? "front-photo.jpg"),
    backDocumentURL
      ? fetchAndEncodeFile(backDocumentURL, identityDocument.attributes["back-photo"]?.filename ?? "back-photo.jpg")
      : undefined,
  ]);

  const idClass = safeParse(picklist(persona.IdentificationClasses), validDocument.id_class.value);
  const bridgeIdType = idClass.success && persona.IdClassToBridge[idClass.output];
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

  const idempotencyKey = crypto.randomUUID();
  const customer = await withRetry(
    () =>
      createCustomer(
        {
          type: "individual",
          first_name: personaAccount.attributes.fields.name.value.first.value,
          last_name: personaAccount.attributes.fields.name.value.last.value,
          email: personaAccount.attributes["email-address"],
          phone: personaAccount.attributes.fields.phone_number.value,
          residential_address: {
            street_line_1: personaAccount.attributes["address-street-1"],
            street_line_2: personaAccount.attributes["address-street-2"] ?? undefined,
            postal_code: personaAccount.attributes["address-postal-code"],
            subdivision: countryCode === "US" ? personaAccount.attributes["address-subdivision"] : undefined,
            country,
            city: personaAccount.attributes["address-city"],
          },
          birth_date: personaAccount.attributes.fields.birthdate.value,
          signed_agreement_id: params.acceptedTermsId,
          endorsements,
          nationality: country,
          identifying_information: identifyingInformation,
        },
        idempotencyKey,
      ),
    {
      retryCount: 2,
      shouldRetry: ({ error }) => {
        const retryable =
          (error instanceof Error && error.name === "TimeoutError") ||
          (error instanceof ServiceError && error.status >= 500);
        if (retryable) captureException(error, { level: "warning" });
        return retryable;
      },
    },
  );
  await database.update(credentials).set({ bridgeId: customer.id }).where(eq(credentials.id, params.credentialId));
}

export async function getDepositDetails(
  currency: (typeof FiatCurrency)[number],
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
) {
  const supportedChainId = Supported[chain.id];
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
      source_deposit_instructions.currency === CurrencyToBridge[currency] && status === "activated",
  );

  virtualAccount ??= await createVirtualAccount(customer.id, {
    source: { currency: CurrencyToBridge[currency] },
    developer_fee_percentage: "0.0",
    destination: { currency: "usdc", payment_rail: supportedChainId, address: account },
  });

  return getDepositDetailsFromVirtualAccount(virtualAccount, account);
}

export async function getCryptoDepositDetails(
  currency: "USDC" | "USDT",
  network: (typeof Network)[number],
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
) {
  const supportedChainId = Supported[chain.id];
  if (!supportedChainId) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }
  if (customer.status !== "active") throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);

  const paymentRail = NetworkToCryptoPaymentRail[network];
  if (!CurrencyByPaymentRail[paymentRail].includes(currency)) {
    throw new Error(ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL);
  }

  const liquidationAddresses = await getLiquidationAddresses(customer.id);
  let liquidationAddress = liquidationAddresses.find(
    ({ chain: bridgeChain, currency: bridgeCurrency }) =>
      bridgeChain === paymentRail && CurrencyToBridge[currency] === bridgeCurrency,
  );

  liquidationAddress ??= await createLiquidationAddress(
    customer.id,
    parse(CreateLiquidationAddress, {
      destination_address: account,
      destination_currency: "usdc",
      destination_payment_rail: supportedChainId,
      currency: CurrencyToBridge[currency],
      chain: paymentRail,
    }),
  );

  return getDepositDetailsFromLiquidationAddress(
    liquidationAddress,
    account,
    paymentRail === "evm" ? parse(picklist(EVMNetwork), network) : undefined,
  );
}

export async function getOfframpDepositDetails(
  externalAccountId: string,
  account: string,
  customer: InferOutput<typeof CustomerResponse>,
  currency: (typeof SupportedCurrency)[number],
) {
  if (customer.status !== "active") throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);
  const supportedChain = Supported[chain.id];
  if (!supportedChain) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  const externalAccount = await getExternalAccount(customer.id, externalAccountId);
  if (!externalAccount) throw new Error(ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND);
  if (externalAccount.currency !== CurrencyToBridge[currency]) {
    throw new Error(ErrorCodes.EXTERNAL_ACCOUNT_CURRENCY_MISMATCH);
  }
  const paymentRail = PaymentRailByBridgeCurrency[externalAccount.currency];
  if (!paymentRail) throw new Error(ErrorCodes.NOT_AVAILABLE_CURRENCY);
  const templates = await getStaticTemplates(customer.id);
  let transfer = templates.find(
    ({ destination, source, state }) =>
      destination.external_account_id === externalAccountId &&
      source.payment_rail === supportedChain &&
      source.currency === "usdc" &&
      state !== "canceled",
  );
  if (transfer && transfer.state !== "awaiting_funds") throw new Error(ErrorCodes.TRANSFER_IN_USE);
  transfer ??= await createTransfer({
    on_behalf_of: customer.id,
    client_reference_id: account,
    source: { currency: "usdc", payment_rail: supportedChain },
    destination: {
      currency: externalAccount.currency,
      payment_rail: paymentRail,
      external_account_id: externalAccountId,
    },
    features: { flexible_amount: true, static_template: true, allow_any_from_address: true },
  });

  return [
    {
      network: "OPTIMISM" as const,
      displayName: "Optimism" as const,
      address: parse(Address, transfer.source_deposit_instructions.to_address),
      fee: "0.0",
      estimatedProcessingTime: "300",
    },
  ];
}

export async function getCryptoOfframpDepositDetails(
  currency: "USDC" | "USDT",
  network: (typeof Network)[number],
  toAddress: string,
  account: Address,
  customer: InferOutput<typeof CustomerResponse>,
  memo?: string,
) {
  if (customer.status !== "active") throw new Error(ErrorCodes.NOT_ACTIVE_CUSTOMER);
  const supportedChain = Supported[chain.id];
  if (!supportedChain) {
    captureException(new Error("bridge not supported chain id"), { contexts: { chain }, level: "error" });
    throw new Error(ErrorCodes.NOT_SUPPORTED_CHAIN_ID);
  }

  const paymentRail = parse(picklist(["solana", "stellar", "tron", "base"]), NetworkToOfframpRail[network]);
  if (!CurrencyByPaymentRail[paymentRail].includes(currency)) {
    throw new Error(ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL);
  }

  const transfer = await createTransfer({
    on_behalf_of: customer.id,
    client_reference_id: account,
    source: { currency: "usdc", payment_rail: supportedChain },
    destination: {
      currency: CurrencyToBridge[currency],
      payment_rail: paymentRail,
      to_address: toAddress,
      blockchain_memo: memo,
    },
    features: { flexible_amount: true, allow_any_from_address: true },
  }).catch((error: unknown) => {
    if (
      error instanceof ServiceError &&
      typeof error.cause === "string" &&
      error.cause.includes(BridgeApiErrorCodes.INVALID_PARAMETERS) &&
      error.cause.includes("to_address")
    ) {
      throw new Error(ErrorCodes.INVALID_DEPOSIT_ADDRESS);
    }
    throw error;
  });

  return [
    {
      network: "OPTIMISM" as const,
      displayName: "Optimism" as const,
      address: parse(Address, transfer.source_deposit_instructions.to_address),
      fee: "0.0",
      estimatedProcessingTime: "300",
    },
  ];
}

export async function removeExternalAccount(customer: InferOutput<typeof CustomerResponse>, externalAccountId: string) {
  const [externalAccount, templates] = await Promise.all([
    getExternalAccount(customer.id, externalAccountId),
    getStaticTemplates(customer.id),
  ]);
  if (!externalAccount) throw new Error(ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND);
  const transfers = templates.filter(
    ({ destination, state }) => destination.external_account_id === externalAccountId && state !== "canceled",
  );
  if (transfers.some(({ state }) => state !== "awaiting_funds")) throw new Error(ErrorCodes.TRANSFER_IN_USE);
  await Promise.all(transfers.map(({ id }) => request(unknown(), `/transfers/${id}`, {}, undefined, "DELETE")));
  await request(unknown(), `/customers/${customer.id}/external_accounts/${externalAccountId}`, {}, undefined, "DELETE");
}

const PaymentRailByBridgeCurrency: Partial<
  Record<(typeof BridgeCurrency)[number], (typeof TransferPaymentRail)[number]>
> = {
  usd: "ach",
  eur: "sepa",
  mxn: "spei",
  brl: "pix",
  gbp: "faster_payments",
};

const missing = new Set(["tax_identification_number", "source_of_funds_questionnaire"]);
const issues = new Set(["government_id_verification_failed"]);

const FutureKYCWindowMs = 30 * 24 * 60 * 60 * 1000;

function maybeKYCLink(bridgeUser: InferOutput<typeof CustomerResponse>, redirectUri?: string) {
  if (bridgeUser.status === "offboarded") return;
  if (
    bridgeUser.endorsements.some((endorsement) => endorsement.requirements.issues.includes("blocklist_check_failed")) ||
    (bridgeUser.endorsements.length > 0 &&
      bridgeUser.endorsements.every((endorsement) =>
        endorsement.requirements.issues.includes("endorsement_not_available_in_customers_region"),
      ))
  ) {
    return;
  }

  if (
    bridgeUser.endorsements.some(
      (endorsement) =>
        containsRequirement(endorsement.requirements.missing, missing) ||
        endorsement.requirements.issues.some((issue) => typeof issue === "string" && issues.has(issue)),
    )
  ) {
    return getKYCLink(bridgeUser.id, redirectUri).catch((error: unknown): undefined => {
      captureException(error, { level: "error" });
    });
  }
}

function futureKYCLink(bridgeUser: InferOutput<typeof CustomerResponse>, redirectUri?: string) {
  const next = bridgeUser.endorsements
    .flatMap((endorsement) => endorsement.future_requirements ?? [])
    .filter(
      (requirement) =>
        requirement.pending.length === 0 &&
        new Date(requirement.effective_date).getTime() - Date.now() <= FutureKYCWindowMs,
    )
    .toSorted((a, b) => new Date(a.effective_date).getTime() - new Date(b.effective_date).getTime())[0];
  if (!next) return;
  return getKYCLink(bridgeUser.id, redirectUri)
    .then((url) => ({ url, date: next.effective_date }))
    .catch((error: unknown): undefined => {
      captureException(error, { level: "error" });
    });
}

function containsRequirement(node: unknown, targets: Set<string>): boolean {
  if (typeof node === "string") return targets.has(node);
  const allOf = safeParse(object({ all_of: array(unknown()) }), node);
  if (allOf.success) return allOf.output.all_of.some((child) => containsRequirement(child, targets));
  const anyOf = safeParse(object({ any_of: array(unknown()) }), node);
  if (anyOf.success) return anyOf.output.any_of.some((child) => containsRequirement(child, targets));
  return false;
}

const Denylist = new Set(["ID"]);
const Endorsements = ["base", "faster_payments", "pix", "sepa", "spei"] as const; // cspell:ignore spei, sepa
export const BridgeCurrency = ["brl", "eur", "gbp", "mxn", "usd", "usdc", "usdt"] as const;

const VirtualAccountStatus = ["activated", "deactivated"] as const;

export const FiatCurrency = ["BRL", "EUR", "GBP", "MXN", "USD"] as const;
export const CryptoCurrency = ["USDT", "USDC"] as const;
export const SupportedCurrency = [...FiatCurrency, ...CryptoCurrency] as const;

export const QuoteCurrency = [
  "BRL",
  "EUR",
  "GBP",
  "MXN",
  "USD",
  "USDC",
  "USDT",
] as const satisfies readonly (typeof SupportedCurrency)[number][];

const CurrencyToBridge: Record<(typeof SupportedCurrency)[number], (typeof BridgeCurrency)[number]> = {
  BRL: "brl",
  EUR: "eur",
  GBP: "gbp",
  MXN: "mxn",
  USD: "usd",
  USDC: "usdc",
  USDT: "usdt",
} as const;

export const CurrencyByEndorsement: Record<(typeof Endorsements)[number], (typeof FiatCurrency)[number][]> = {
  base: ["USD"],
  faster_payments: ["GBP"],
  pix: ["BRL"],
  sepa: ["EUR"],
  spei: ["MXN"],
};

export const CryptoPaymentRail = ["evm", "solana", "stellar", "tron", "base"] as const;
export const BridgeChain = ["optimism"] as const;

const CurrencyByPaymentRail: Record<(typeof CryptoPaymentRail)[number], (typeof CryptoCurrency)[number][]> = {
  base: ["USDC"],
  evm: ["USDC"],
  solana: ["USDC"],
  stellar: ["USDC"],
  tron: ["USDT"],
};

const NetworkToCryptoPaymentRail: Record<(typeof Network)[number], (typeof CryptoPaymentRail)[number]> = {
  BASE: "evm",
  SOLANA: "solana",
  STELLAR: "stellar",
  TRON: "tron",
} as const;

const NetworkToOfframpRail: Record<(typeof OfframpNetwork)[number], (typeof CryptoPaymentRail)[number]> = {
  BASE: "base",
  SOLANA: "solana",
  STELLAR: "stellar",
  TRON: "tron",
} as const;

const Supported: Record<number, (typeof BridgeChain)[number]> = {
  [optimism.id]: "optimism",
  [optimismSepolia.id]: "optimism",
} as const;

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

const EndorsementStatus = ["incomplete", "approved", "revoked"] as const;

const Quote = object({ midmarket_rate: string(), buy_rate: string(), sell_rate: string() }); // cspell:ignore midmarket

const AgreementLinkResponse = object({ url: string() });

const CustomerResponse = object({
  id: string(),
  email: string(),
  status: picklist(CustomerStatus),
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
      future_requirements: optional(
        array(
          object({
            effective_date: string(),
            pending: array(string()),
          }),
        ),
      ),
    }),
  ),
});

const IdentityDocument = object({
  type: string(),
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

const NewCustomer = object({ status: picklist(CustomerStatus), id: string() });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateVirtualAccount = object({
  developer_fee_percentage: optional(string()),
  source: object({
    currency: picklist(BridgeCurrency),
  }),
  destination: object({
    currency: picklist(["usdc"]),
    payment_rail: picklist(BridgeChain),
    address: Address,
  }),
});

const VirtualAccount = object({
  id: string(),
  status: picklist(VirtualAccountStatus),
  developer_fee_percentage: optional(string()),
  source_deposit_instructions: variant("currency", [
    object({
      currency: literal("brl" as const satisfies (typeof BridgeCurrency)[number]),
      account_holder_name: string(),
      br_code: string(),
    }),
    object({
      currency: literal("usd" as const satisfies (typeof BridgeCurrency)[number]),
      bank_name: string(),
      bank_address: string(),
      bank_routing_number: string(),
      bank_account_number: string(),
      bank_beneficiary_name: string(),
      bank_beneficiary_address: string(),
    }),
    object({
      currency: literal("eur" as const satisfies (typeof BridgeCurrency)[number]),
      bank_name: string(),
      bank_address: string(),
      account_holder_name: string(),
      iban: string(), // cspell:ignore iban
      bic: string(),
    }),
    object({
      currency: literal("mxn" as const satisfies (typeof BridgeCurrency)[number]),
      account_holder_name: string(),
      clabe: string(), // cspell:ignore clabe
    }),
    object({
      currency: literal("gbp" as const satisfies (typeof BridgeCurrency)[number]),
      account_number: string(),
      sort_code: string(),
      account_holder_name: string(),
      bank_name: string(),
      bank_address: string(),
    }),
  ]),
  destination: object({
    address: Address,
  }),
});
const VirtualAccounts = object({ count: number(), data: array(VirtualAccount) });

const CreateLiquidationAddress = object({
  currency: picklist(["usdc", "usdt"]),
  chain: picklist([...CryptoPaymentRail]),
  destination_payment_rail: picklist(BridgeChain),
  destination_currency: picklist(["usdc"]),
  destination_address: Address,
});

const LiquidationAddress = object({
  id: string(),
  currency: picklist(["usdc", "usdt", "any"]),
  chain: picklist([...CryptoPaymentRail]),
  address: string(),
  destination_address: Address,
  blockchain_memo: optional(string()),
});

const LiquidationAddresses = object({ count: number(), data: array(LiquidationAddress) });

const AccountOwnerName = pipe(string(), minLength(1), maxLength(256));
const BankName = pipe(string(), minLength(1), maxLength(256));
const RoutingNumber = pipe(string(), regex(/^\d{9}$/, "9 digits"));
const DocumentNumber = pipe(string(), regex(/^\d+$/, "digits only"));
const CountryCode = pipe(string(), length(3, "3-letter iso 3166-1 code"));

const AddressInput = object({
  streetLine1: pipe(string(), minLength(4), maxLength(35)),
  streetLine2: optional(pipe(string(), maxLength(35))),
  city: pipe(string(), minLength(1)),
  state: optional(pipe(string(), minLength(1), maxLength(3, "1-3 character iso 3166-2 code"))),
  postalCode: optional(pipe(string(), minLength(1))),
  country: CountryCode,
});

export const ExternalAccountInput = variant("currency", [
  object({
    currency: literal("USD"),
    accountOwnerName: AccountOwnerName,
    accountNumber: pipe(string(), minLength(1)),
    routingNumber: RoutingNumber,
    checkingOrSavings: optional(picklist(["checking", "savings"])),
    bankName: optional(BankName),
    address: object({
      ...AddressInput.entries,
      state: pipe(string(), minLength(1), maxLength(3, "1-3 character iso 3166-2 code")),
    }),
  }),
  object({
    currency: literal("EUR"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    accountOwnerType: literal("individual"),
    firstName: pipe(string(), minLength(1)),
    lastName: pipe(string(), minLength(1)),
    accountNumber: pipe(string(), minLength(1)),
    bic: optional(pipe(string(), minLength(1))),
    country: CountryCode,
    bankName: optional(BankName),
  }),
  object({
    currency: literal("EUR"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    accountOwnerType: literal("business"),
    businessName: pipe(string(), minLength(1)),
    accountNumber: pipe(string(), minLength(1)),
    bic: optional(pipe(string(), minLength(1))),
    country: CountryCode,
    bankName: optional(BankName),
  }),
  object({
    currency: literal("MXN"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    clabe: pipe(string(), regex(/^\d{18}$/, "18 digits")),
    bankName: optional(BankName),
  }),
  object({
    currency: literal("BRL"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    account: union([
      object({ pixKey: pipe(string(), minLength(1)), documentNumber: optional(DocumentNumber) }),
      object({ brCode: pipe(string(), minLength(1)), documentNumber: optional(DocumentNumber) }),
    ]),
    bankName: optional(BankName),
  }),
  object({
    currency: literal("GBP"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    accountOwnerType: literal("individual"),
    firstName: pipe(string(), minLength(1)),
    lastName: pipe(string(), minLength(1)),
    accountNumber: pipe(string(), regex(/^\d{8}$/, "8 digits")),
    sortCode: pipe(string(), regex(/^\d{6}$/, "6 digits, no hyphens")),
    bankName: optional(BankName),
  }),
  object({
    currency: literal("GBP"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    accountOwnerType: literal("business"),
    businessName: pipe(string(), minLength(1)),
    accountNumber: pipe(string(), regex(/^\d{8}$/, "8 digits")),
    sortCode: pipe(string(), regex(/^\d{6}$/, "6 digits, no hyphens")),
    bankName: optional(BankName),
  }),
  object({
    currency: literal("GBP"),
    address: optional(AddressInput),
    accountOwnerName: AccountOwnerName,
    accountNumber: pipe(string(), regex(/^\d{8}$/, "8 digits")),
    sortCode: pipe(string(), regex(/^\d{6}$/, "6 digits, no hyphens")),
    bankName: optional(BankName),
  }),
]);

export const UpdateExternalAccountInput = pipe(
  object({
    address: optional(AddressInput),
    account: optional(
      pipe(
        object({
          checkingOrSavings: optional(picklist(["checking", "savings"])),
          routingNumber: optional(RoutingNumber),
        }),
        check(
          ({ checkingOrSavings, routingNumber }) => checkingOrSavings !== undefined || routingNumber !== undefined,
          "account requires at least one field",
        ),
      ),
    ),
  }),
  check(({ address, account }) => address !== undefined || account !== undefined, "address or account is required"),
);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only usage
const BridgeCreateExternalAccount = variant("account_type", [
  object({
    account_type: literal("us"),
    currency: literal("usd"),
    account_owner_name: string(),
    bank_name: optional(string()),
    account: object({
      account_number: string(),
      routing_number: string(),
      checking_or_savings: optional(picklist(["checking", "savings"])),
    }),
    address: object({
      city: string(),
      country: string(),
      postal_code: optional(string()),
      state: optional(string()),
      street_line_1: string(),
      street_line_2: optional(string()),
    }),
  }),
  object({
    account_type: literal("iban"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("eur"),
    account_owner_name: string(),
    account_owner_type: literal("individual"),
    first_name: string(),
    last_name: string(),
    bank_name: optional(string()),
    iban: object({ account_number: string(), bic: optional(string()), country: string() }),
  }),
  object({
    account_type: literal("iban"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("eur"),
    account_owner_name: string(),
    account_owner_type: literal("business"),
    business_name: string(),
    bank_name: optional(string()),
    iban: object({ account_number: string(), bic: optional(string()), country: string() }),
  }),
  object({
    account_type: literal("clabe"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("mxn"),
    account_owner_name: string(),
    bank_name: optional(string()),
    clabe: object({ account_number: string() }),
  }),
  object({
    account_type: literal("pix"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("brl"),
    account_owner_name: string(),
    bank_name: optional(string()),
    pix_key: object({ pix_key: string(), document_number: optional(string()) }),
  }),
  object({
    account_type: literal("pix"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("brl"),
    account_owner_name: string(),
    bank_name: optional(string()),
    br_code: object({ br_code: string(), document_number: optional(string()) }),
  }),
  object({
    account_type: literal("gb"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("gbp"),
    account_owner_name: string(),
    account_owner_type: literal("individual"),
    first_name: string(),
    last_name: string(),
    bank_name: optional(string()),
    account: object({ account_number: string(), sort_code: string() }),
  }),
  object({
    account_type: literal("gb"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("gbp"),
    account_owner_name: string(),
    account_owner_type: literal("business"),
    business_name: string(),
    bank_name: optional(string()),
    account: object({ account_number: string(), sort_code: string() }),
  }),
  object({
    account_type: literal("gb"),
    address: optional(
      object({
        city: string(),
        country: string(),
        postal_code: optional(string()),
        state: optional(string()),
        street_line_1: string(),
        street_line_2: optional(string()),
      }),
    ),
    currency: literal("gbp"),
    account_owner_name: string(),
    bank_name: optional(string()),
    account: object({ account_number: string(), sort_code: string() }),
  }),
]);

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-only usage
const BridgeUpdateExternalAccount = object({
  address: optional(
    object({
      street_line_1: string(),
      street_line_2: optional(string()),
      city: string(),
      state: optional(string()),
      postal_code: optional(string()),
      country: string(),
    }),
  ),
  account: optional(
    object({ checking_or_savings: optional(picklist(["checking", "savings"])), routing_number: optional(string()) }),
  ),
});

const BridgeExternalAccount = object({
  id: string(),
  customer_id: string(),
  account_type: string(),
  currency: picklist(BridgeCurrency),
  account_owner_name: string(),
  bank_name: optional(string()),
  active: boolean(),
  beneficiary_address_valid: boolean(),
});

const ExternalAccounts = object({ count: number(), data: array(BridgeExternalAccount) });

export const ExternalAccount = object({
  addressValid: boolean(),
  bankName: optional(string()),
  currency: picklist(FiatCurrency),
  id: string(),
  ownerName: string(),
});

const FiatByBridgeCurrency: Partial<Record<(typeof BridgeCurrency)[number], (typeof FiatCurrency)[number]>> = {
  brl: "BRL",
  eur: "EUR",
  gbp: "GBP",
  mxn: "MXN",
  usd: "USD",
};

const TransferCurrency = [
  "brl",
  "cop",
  "dai",
  "eur",
  "eurc", // cspell:ignore eurc
  "gbp",
  "mxn",
  "pyusd", // cspell:ignore pyusd
  "usd",
  "usdb", // cspell:ignore usdb
  "usdc",
  "usdt",
] as const;

const TransferPaymentRail = [
  "ach",
  "ach_push",
  "ach_same_day",
  "arbitrum",
  "avalanche_c_chain",
  "base",
  "bre_b", // cspell:ignore bre_b
  "bridge_wallet",
  "celo",
  "co_bank_transfer",
  "ethereum",
  "faster_payments",
  "fiat_deposit_return",
  "optimism",
  "pix",
  "polygon",
  "sepa",
  "solana",
  "spei",
  "stellar",
  "swift",
  "tempo",
  "tron",
  "wire",
] as const;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CreateTransfer = object({
  on_behalf_of: string(),
  client_reference_id: optional(string()),
  amount: optional(string()),
  developer_fee: optional(string()),
  developer_fee_percent: optional(string()),
  features: optional(
    object({
      flexible_amount: optional(boolean()),
      static_template: optional(boolean()),
      allow_any_from_address: optional(boolean()),
    }),
  ),
  source: object({
    currency: picklist(TransferCurrency),
    payment_rail: picklist(TransferPaymentRail),
    from_address: optional(Address),
    bridge_wallet_id: optional(string()),
  }),
  destination: object({
    currency: picklist(TransferCurrency),
    payment_rail: picklist(TransferPaymentRail),
    external_account_id: optional(string()),
    bridge_wallet_id: optional(string()),
    to_address: optional(string()),
    amount: optional(string()),
    wire_message: optional(string()),
    sepa_reference: optional(string()),
    swift_reference: optional(string()),
    spei_reference: optional(string()),
    ach_reference: optional(string()),
    blockchain_memo: optional(string()),
    swift_charges: optional(picklist(["ben", "our", "sha"])),
  }),
});

const Transfer = object({
  id: string(),
  client_reference_id: optional(string()),
  state: string(),
  amount: nullish(string()),
  currency: optional(picklist(TransferCurrency)),
  developer_fee: optional(string()),
  developer_fee_percent: optional(string()),
  on_behalf_of: string(),
  source: object({
    payment_rail: picklist(TransferPaymentRail),
    currency: picklist(TransferCurrency),
    from_address: nullish(string()),
  }),
  destination: object({
    blockchain_memo: nullish(string()),
    currency: picklist(TransferCurrency),
    external_account_id: nullish(string()),
    payment_rail: picklist(TransferPaymentRail),
    to_address: nullish(string()),
  }),
  source_deposit_instructions: object({
    payment_rail: picklist(TransferPaymentRail),
    currency: picklist(TransferCurrency),
    from_address: nullish(string()),
    to_address: nullish(string()),
  }),
});

const Transfers = object({ count: number(), data: array(Transfer) });

const StaticTemplates = object({ count: number(), data: array(Transfer) });

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
  idempotencyKey?: string,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: {
      ...headers,
      "api-key": apiKey,
      ...(method === "POST" && { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() }),
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new ServiceError("Bridge", response.status, await response.text());
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return parse(schema, {});
  const result = safeParse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
  if (!result.success) {
    setContext("validation", { ...result, flatten: flatten(result.issues) });
    throw new ValiError(result.issues);
  }
  return result.output;
}

async function encodeFile(file: File) {
  return file
    .arrayBuffer()
    .then((buffer) => Buffer.from(buffer).toString("base64"))
    .then((base64) => `data:${file.type || "image/jpeg"};base64,${base64}`);
}

async function fetchAndEncodeFile(url: string, fileName: string) {
  const response = await fetch(url);
  if (!response.ok) throw new ServiceError("Bridge", response.status, await response.text());
  const file = await response.blob();
  return encodeFile(new File([file], fileName));
}

function getDepositDetailsFromVirtualAccount(virtualAccount: InferOutput<typeof VirtualAccount>, account: string) {
  if (virtualAccount.destination.address.toLowerCase() !== account.toLowerCase()) {
    throw new Error(ErrorCodes.INVALID_ACCOUNT);
  }
  switch (virtualAccount.source_deposit_instructions.currency) {
    case "usd":
      return [
        {
          network: "ACH" as const,
          displayName: "ACH" as const,
          beneficiaryName: virtualAccount.source_deposit_instructions.bank_beneficiary_name,
          routingNumber: virtualAccount.source_deposit_instructions.bank_routing_number,
          accountNumber: virtualAccount.source_deposit_instructions.bank_account_number,
          bankAddress: virtualAccount.source_deposit_instructions.bank_address,
          beneficiaryAddress: virtualAccount.source_deposit_instructions.bank_beneficiary_address,
          bankName: virtualAccount.source_deposit_instructions.bank_name,
          fee: "0.0",
          estimatedProcessingTime: "1 - 3 business days",
        },
        {
          network: "WIRE" as const,
          displayName: "WIRE" as const,
          beneficiaryName: virtualAccount.source_deposit_instructions.bank_beneficiary_name,
          routingNumber: virtualAccount.source_deposit_instructions.bank_routing_number,
          accountNumber: virtualAccount.source_deposit_instructions.bank_account_number,
          bankAddress: virtualAccount.source_deposit_instructions.bank_address,
          beneficiaryAddress: virtualAccount.source_deposit_instructions.bank_beneficiary_address,
          bankName: virtualAccount.source_deposit_instructions.bank_name,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "eur":
      return [
        {
          network: "SEPA" as const,
          displayName: "SEPA" as const,
          beneficiaryName: virtualAccount.source_deposit_instructions.account_holder_name,
          iban: virtualAccount.source_deposit_instructions.iban,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "mxn":
      return [
        {
          network: "SPEI" as const,
          displayName: "SPEI" as const,
          beneficiaryName: virtualAccount.source_deposit_instructions.account_holder_name,
          clabe: virtualAccount.source_deposit_instructions.clabe,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "brl":
      return [
        {
          network: "PIX-BR" as const,
          displayName: "PIX BR" as const,
          beneficiaryName: virtualAccount.source_deposit_instructions.account_holder_name,
          brCode: virtualAccount.source_deposit_instructions.br_code,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "gbp":
      return [
        {
          network: "FASTER_PAYMENTS" as const,
          displayName: "Faster Payments" as const,
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
  evmNetwork?: (typeof EVMNetwork)[number],
) {
  if (liquidationAddress.destination_address.toLowerCase() !== account.toLowerCase()) {
    throw new Error(ErrorCodes.INVALID_ACCOUNT);
  }

  switch (liquidationAddress.chain) {
    case "evm":
      if (!evmNetwork) throw new Error(ErrorCodes.NOT_AVAILABLE_EVM_NETWORK);
      return [
        {
          network: evmNetwork,
          displayName: evmNetwork,
          address: parse(Address, liquidationAddress.address),
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "tron":
      return [
        {
          network: "TRON" as const,
          displayName: "TRON" as const,
          address: liquidationAddress.address,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "solana":
      return [
        {
          network: "SOLANA" as const,
          displayName: "SOLANA" as const,
          address: liquidationAddress.address,
          fee: "0.0",
          estimatedProcessingTime: "300",
        },
      ];
    case "stellar":
      if (!liquidationAddress.blockchain_memo) throw new Error(ErrorCodes.MISSING_STELLAR_MEMO);
      return [
        {
          network: "STELLAR" as const,
          displayName: "STELLAR" as const,
          address: liquidationAddress.address,
          fee: "0.0",
          estimatedProcessingTime: "300",
          memo: liquidationAddress.blockchain_memo,
        },
      ];
  }
  throw new Error(ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL);
}

export const ErrorCodes = {
  ALREADY_ONBOARDED: "already onboarded",
  BAD_BRIDGE_ID: "bad bridge id",
  DENYLISTED_COUNTRY: "denylisted country",
  EMAIL_ALREADY_EXISTS: "email already exists",
  EXTERNAL_ACCOUNT_CURRENCY_MISMATCH: "external account currency mismatch",
  EXTERNAL_ACCOUNT_NOT_FOUND: "external account not found",
  INVALID_ACCOUNT: "invalid destination account",
  INVALID_ADDRESS: "invalid address",
  INVALID_DEPOSIT_ADDRESS: "invalid deposit address",
  NOT_ACTIVE_CUSTOMER: "not active customer",
  NO_ENDORSEMENT: "no endorsement",
  NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL: "not available crypto payment rail",
  NOT_AVAILABLE_CURRENCY: "not available currency",
  MISSING_STELLAR_MEMO: "missing stellar memo",
  NOT_AVAILABLE_EVM_NETWORK: "not available evm network",
  NOT_ENABLED: "not enabled",
  NOT_FOUND_IDENTIFICATION_CLASS: "not found identification class",
  NOT_SUPPORTED_CHAIN_ID: "not supported chain id",
  NO_COUNTRY_ALPHA3: "no country alpha3",
  NO_DOCUMENT: "no document",
  NO_DOCUMENT_FILE: "no document file",
  NO_PERSONA_ACCOUNT: "no persona account",
  NO_SOCIAL_SECURITY_NUMBER: "no social security number",
  TRANSFER_IN_USE: "transfer in use",
};

const BridgeApiErrorCodes = {
  EMAIL_ALREADY_EXISTS: "A customer with this email already exists",
  INVALID_PARAMETERS: "invalid_parameters",
  NOT_FOUND: "not_found",
} as const;

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- ignore empty string */
export const publicKey =
  process.env.BRIDGE_WEBHOOK_PUBLIC_KEY ||
  {
    "web.exactly.app": `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3iaPv91f5xNeSu41hSi/
cMIvCPmrezsW/ZTzE8CxOTBTd+jFokCoOm5PCd6FKRz/So/gUeQP4ejvK81CVXTX
gAnsg/+By1XUc0HFs6X8F8iQEgzpLlT47ulh1yIiTTop14QPwApG7b8YafvNZgdB
LW/SeDREQ9RqxJCpCPboRrZGiD2JZzisrrk6uPuDLq4yy59uWg+EoIop/qSKjbe+
ZNEUuNgaDl+kjNq7kDXsvyoKWeS05dtxpWljhxMCsBVTawiCWhg3wTEMPa+Ui8Gg
PBs4homDyXrVIA3aw7JYEZJLtJkmWKgSyQtDc8yZnUPyBj+pNmWBqqq1IIeYJ4QF
1QIDAQAB
-----END PUBLIC KEY-----`,
    "sandbox.exactly.app": `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxrV+s8CvC0+s1W6vZG52
5eozo6W6HzkTcLQMWDoEzQX+ulEoYH2fPuXeupi11MdVLpEqNqYas8LD3BIf/c9H
kK54V8vnXNwoHa5ROp/Gjp3B17q3wGfjLa8bQJoJZFWd9W+e3TjUohCDNpeD/qv+
bkY2y3b1QixmXKK3REw35sfiEe5NkGMU4aEfXhZieIZ1mKXLsIgsgrIpv9BFwQr5
+h3R7Vv3hGKVgSZHnRMa9F1/go8v5Au8gj+9w0LxxRJikoJCubI6igaTCivibxuo
QXWfFylw6m7eQTvZDQz70pnUEakofRlvKasetbyKmvLzMhuRHeqsxgi8C4ZCx7MP
dwIDAQAB
-----END PUBLIC KEY-----`,
  }[domain] ||
  `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxrV+s8CvC0+s1W6vZG52
5eozo6W6HzkTcLQMWDoEzQX+ulEoYH2fPuXeupi11MdVLpEqNqYas8LD3BIf/c9H
kK54V8vnXNwoHa5ROp/Gjp3B17q3wGfjLa8bQJoJZFWd9W+e3TjUohCDNpeD/qv+
bkY2y3b1QixmXKK3REw35sfiEe5NkGMU4aEfXhZieIZ1mKXLsIgsgrIpv9BFwQr5
+h3R7Vv3hGKVgSZHnRMa9F1/go8v5Au8gj+9w0LxxRJikoJCubI6igaTCivibxuo
QXWfFylw6m7eQTvZDQz70pnUEakofRlvKasetbyKmvLzMhuRHeqsxgi8C4ZCx7MP
dwIDAQAB
-----END PUBLIC KEY-----`;
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
