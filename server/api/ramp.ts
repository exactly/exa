import { vValidator } from "@hono/valibot-validator";
import { captureException, setUser } from "@sentry/core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  array,
  literal,
  object,
  optional,
  parse,
  picklist,
  pipe,
  string,
  union,
  url,
  variant,
  type InferInput,
  type InferOutput,
} from "valibot";

import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import {
  ADDRESS_TEMPLATE,
  createInquiry,
  getInquiry,
  MANTECA_TEMPLATE_EXTRA_FIELDS,
  resumeInquiry,
} from "../utils/persona";
import * as bridge from "../utils/ramps/bridge";
import * as manteca from "../utils/ramps/manteca";
import validatorHook from "../utils/validatorHook";

const ErrorCodes = {
  EXTERNAL_ACCOUNT_ALREADY_EXISTS: "external account already exists",
  EXTERNAL_ACCOUNT_CURRENCY_MISMATCH: "external account currency mismatch",
  EXTERNAL_ACCOUNT_NOT_FOUND: "external account not found",
  EXTERNAL_ACCOUNT_NOT_SUPPORTED: "external account not supported",
  INVALID_BANK_NAME: "invalid bank name",
  INVALID_DEPOSIT_ADDRESS: "invalid deposit address",
  NO_CREDENTIAL: "no credential",
  NOT_APPROVED: "not approved",
  NOT_STARTED: "not started",
  POSTAL_CODE_REQUIRED: "postal code required",
  WITHDRAWAL_IN_PROGRESS: "withdrawal in progress",
};

export default new Hono()
  .get(
    "/",
    auth(),
    vValidator(
      "query",
      object({ countryCode: optional(string()), redirectURL: optional(pipe(string(), url())) }),
      validatorHook(),
    ),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");

      const countryCode = c.req.valid("query").countryCode;
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, bridgeId: true },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
      const account = parse(Address, credential.account);
      setUser({ id: account });

      const redirectURL = c.req.valid("query").redirectURL;
      const [mantecaProvider, bridgeProvider] = await Promise.all([
        manteca.getProvider(account, countryCode).catch((error: unknown) => {
          captureException(error, { level: "error", contexts: { credential, params: { countryCode } } });
          return { onramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
        }),
        bridge
          .getProvider({
            credentialId,
            customerId: credential.bridgeId,
            countryCode,
            redirectURL,
          })
          .catch((error: unknown) => {
            captureException(error, { level: "error", contexts: { credential, params: { countryCode } } });
            return {
              onramp: { currencies: [] },
              offramp: { currencies: [] },
              status: "NOT_AVAILABLE" as const,
            };
          }),
      ]);

      return c.json(
        {
          manteca: { provider: "manteca" as const, ...mantecaProvider } satisfies InferInput<typeof ProviderInfo>,
          bridge: { provider: "bridge" as const, ...bridgeProvider } satisfies InferInput<typeof ProviderInfo>,
        },
        200,
      );
    },
  )
  .get(
    "/quote",
    auth(),
    vValidator(
      "query",
      variant("provider", [
        object({
          currency: picklist(manteca.Currency),
          direction: optional(literal("onramp")),
          provider: literal("manteca"),
        }),
        object({
          currency: picklist(bridge.FiatCurrency),
          direction: optional(literal("onramp")),
          provider: literal("bridge"),
        }),
        object({
          currency: picklist(bridge.FiatCurrency),
          direction: literal("offramp"),
          externalAccountId: string(),
          provider: literal("bridge"),
        }),
        object({
          address: Address,
          currency: literal("USDC"),
          direction: literal("offramp"),
          network: literal("BASE"),
          provider: literal("bridge"),
        }),
        object({
          address: string(),
          currency: literal("USDC"),
          direction: literal("offramp"),
          network: literal("SOLANA"),
          provider: literal("bridge"),
        }),
        object({
          address: string(),
          currency: literal("USDC"),
          direction: literal("offramp"),
          memo: string(),
          network: literal("STELLAR"),
          provider: literal("bridge"),
        }),
        object({
          address: string(),
          currency: literal("USDT"),
          direction: literal("offramp"),
          network: literal("TRON"),
          provider: literal("bridge"),
        }),
        object({
          currency: literal("USDT"),
          direction: optional(literal("onramp")),
          network: literal("TRON"),
          provider: literal("bridge"),
        }),
        object({
          currency: literal("USDC"),
          direction: optional(literal("onramp")),
          network: picklist([...bridge.EVMNetwork, "SOLANA", "STELLAR"]),
          provider: literal("bridge"),
        }),
      ]),
      validatorHook(),
    ),
    async (c) => {
      const query = c.req.valid("query");
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, bridgeId: true },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
      const account = parse(Address, credential.account);
      setUser({ id: account });

      switch (query.provider) {
        case "manteca": {
          const mantecaUser = await manteca.getUser(account);
          if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          try {
            const depositInfo: InferOutput<typeof RampResponse>["depositInfo"] = manteca.getDepositDetails(
              query.currency,
              mantecaUser.exchange,
            );
            return c.json(
              {
                quote: (await manteca.getQuote(`USDC_${query.currency}`)) satisfies QuoteResponse,
                depositInfo,
              },
              200,
            );
          } catch (error) {
            captureException(error, { level: "error", contexts: { credential } });
            if (error instanceof Error && Object.values(manteca.ErrorCodes).includes(error.message)) {
              switch (error.message) {
                case manteca.ErrorCodes.NOT_SUPPORTED_CURRENCY:
                  return c.json({ code: error.message }, 400);
              }
            }
            throw error;
          }
        }
        case "bridge": {
          if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          const bridgeUser = await bridge.getCustomer(credential.bridgeId);
          if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          if (bridgeUser.status !== "active") return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);
          const quote = (await bridge.getQuote("USD", query.currency)) satisfies QuoteResponse;

          if (query.direction === "offramp") {
            if ("network" in query) {
              try {
                return c.json(
                  {
                    quote,
                    depositInfo: await bridge.getCryptoOfframpDepositDetails(
                      query.currency,
                      query.network,
                      query.address,
                      parse(Address, credential.account),
                      bridgeUser,
                      query.network === "STELLAR" ? query.memo : undefined,
                    ),
                  } satisfies InferOutput<typeof RampResponse>,
                  200,
                );
              } catch (error) {
                if (error instanceof Error && error.message === bridge.ErrorCodes.INVALID_DEPOSIT_ADDRESS) {
                  return c.json({ code: ErrorCodes.INVALID_DEPOSIT_ADDRESS }, 400);
                }
                throw error;
              }
            }
            try {
              return c.json(
                {
                  quote,
                  depositInfo: await bridge.getOfframpDepositDetails(
                    query.externalAccountId,
                    credential.account,
                    bridgeUser,
                    query.currency,
                  ),
                } satisfies InferOutput<typeof RampResponse>,
                200,
              );
            } catch (error) {
              if (error instanceof Error && error.message === bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND) {
                return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND }, 400);
              }
              if (error instanceof Error && error.message === bridge.ErrorCodes.NOT_AVAILABLE_CURRENCY) {
                return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_SUPPORTED }, 400);
              }
              if (error instanceof Error && error.message === bridge.ErrorCodes.EXTERNAL_ACCOUNT_CURRENCY_MISMATCH) {
                return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_CURRENCY_MISMATCH }, 400);
              }
              if (error instanceof Error && error.message === bridge.ErrorCodes.TRANSFER_IN_USE) {
                return c.json({ code: ErrorCodes.WITHDRAWAL_IN_PROGRESS }, 400);
              }
              throw error;
            }
          }

          if ("network" in query) {
            return c.json(
              {
                quote,
                depositInfo: await bridge.getCryptoDepositDetails(
                  query.currency,
                  query.network,
                  credential.account,
                  bridgeUser,
                ),
              } satisfies InferOutput<typeof RampResponse>,
              200,
            );
          }

          return c.json(
            {
              quote,
              depositInfo: await bridge.getDepositDetails(query.currency, credential.account, bridgeUser),
            } satisfies InferOutput<typeof RampResponse>,
            200,
          );
        }
      }
    },
  )
  .post(
    "/",
    auth(),
    vValidator(
      "json",
      variant("provider", [
        object({ provider: literal("bridge"), acceptedTermsId: string() }),
        object({ provider: literal("manteca") }),
      ]),
      validatorHook({ code: "bad onboarding" }),
    ),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const onboarding = c.req.valid("json");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, bridgeId: true },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
      const account = parse(Address, credential.account);
      setUser({ id: account });

      switch (onboarding.provider) {
        case "manteca":
          try {
            await manteca.onboarding(account, credentialId);
          } catch (error) {
            captureException(error, { level: "error", contexts: { credential } });
            if (error instanceof Error && Object.values(manteca.ErrorCodes).includes(error.message)) {
              switch (error.message) {
                case manteca.ErrorCodes.NO_DOCUMENT:
                  return c.json({ code: error.message }, 400);
                case manteca.ErrorCodes.INVALID_LEGAL_ID: {
                  const { inquiryId, sessionToken } = await getOrCreateInquiry(
                    credentialId,
                    MANTECA_TEMPLATE_EXTRA_FIELDS,
                  );
                  return c.json({ code: error.message, inquiryId, sessionToken }, 400);
                }
              }
            }
            throw error;
          }
          break;
        case "bridge":
          try {
            await bridge.onboarding({
              credentialId,
              customerId: credential.bridgeId,
              acceptedTermsId: onboarding.acceptedTermsId,
            });
          } catch (error) {
            captureException(error, { level: "error", contexts: { credential } });
            if (error instanceof Error && Object.values(bridge.ErrorCodes).includes(error.message)) {
              switch (error.message) {
                case bridge.ErrorCodes.ALREADY_ONBOARDED:
                case bridge.ErrorCodes.DENYLISTED_COUNTRY:
                case bridge.ErrorCodes.NOT_ENABLED:
                  return c.json({ code: error.message }, 400);
                case bridge.ErrorCodes.INVALID_ADDRESS: {
                  const { inquiryId, sessionToken } = await getOrCreateInquiry(credentialId, ADDRESS_TEMPLATE);
                  return c.json({ code: error.message, inquiryId, sessionToken }, 400);
                }
              }
            }
            throw error;
          }
          break;
      }
      return c.json({ code: "ok" }, 200);
    },
  )
  .post("/external-account", auth(), vValidator("json", bridge.ExternalAccountInput, validatorHook()), async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, bridgeId: true },
    });
    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
    if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
    setUser({ id: parse(Address, credential.account) });

    const bridgeUser = await bridge.getCustomer(credential.bridgeId);
    if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
    if (bridgeUser.status !== "active") return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);

    try {
      return c.json(await bridge.createExternalAccount(bridgeUser, c.req.valid("json")), 200);
    } catch (error) {
      if (error instanceof Error && error.message === bridge.ErrorCodes.NO_ENDORSEMENT) {
        return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);
      }
      if (error instanceof Error && error.message === bridge.ErrorCodes.INVALID_BANK_NAME) {
        return c.json({ code: ErrorCodes.INVALID_BANK_NAME }, 400);
      }
      if (error instanceof Error && error.message === bridge.ErrorCodes.POSTAL_CODE_REQUIRED) {
        return c.json({ code: ErrorCodes.POSTAL_CODE_REQUIRED }, 400);
      }
      if (error instanceof Error && error.message === bridge.ErrorCodes.EXTERNAL_ACCOUNT_ALREADY_EXISTS) {
        return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_ALREADY_EXISTS }, 400);
      }
      throw error;
    }
  })
  .get("/external-account", auth(), async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, bridgeId: true },
    });
    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
    if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
    setUser({ id: parse(Address, credential.account) });

    const bridgeUser = await bridge.getCustomer(credential.bridgeId);
    if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
    if (bridgeUser.status !== "active") return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);

    return c.json(await bridge.listExternalAccounts(credential.bridgeId), 200);
  })
  .patch(
    "/external-account/:id",
    auth(),
    vValidator("param", object({ id: string() }), validatorHook()),
    vValidator("json", bridge.UpdateExternalAccountInput, validatorHook()),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, bridgeId: true },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
      if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
      setUser({ id: parse(Address, credential.account) });

      const bridgeUser = await bridge.getCustomer(credential.bridgeId);
      if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
      if (bridgeUser.status !== "active") return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);
      try {
        return c.json(
          await bridge.updateExternalAccount(bridgeUser, c.req.valid("param").id, c.req.valid("json")),
          200,
        );
      } catch (error) {
        if (error instanceof Error && error.message === bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND) {
          return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND }, 400);
        }
        throw error;
      }
    },
  )
  .delete(
    "/external-account/:id",
    auth(),
    vValidator("param", object({ id: string() }), validatorHook()),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, bridgeId: true },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
      if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
      setUser({ id: parse(Address, credential.account) });

      const bridgeUser = await bridge.getCustomer(credential.bridgeId);
      if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
      if (bridgeUser.status !== "active") return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);

      try {
        await bridge.removeExternalAccount(bridgeUser, c.req.valid("param").id);
      } catch (error) {
        if (error instanceof Error && error.message === bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND) {
          return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND }, 400);
        }
        if (error instanceof Error && error.message === bridge.ErrorCodes.TRANSFER_IN_USE) {
          return c.json({ code: ErrorCodes.WITHDRAWAL_IN_PROGRESS }, 400);
        }
        throw error;
      }
      return c.json({ code: "ok" }, 200);
    },
  );

async function getOrCreateInquiry(credentialId: string, template: string) {
  const existing = await getInquiry(credentialId, template);
  const { data: inquiry } =
    existing?.attributes.status === "created" ||
    existing?.attributes.status === "pending" ||
    existing?.attributes.status === "expired"
      ? { data: { id: existing.id } }
      : await createInquiry(credentialId, template);
  const { meta } = await resumeInquiry(inquiry.id);
  return { inquiryId: inquiry.id, sessionToken: meta["session-token"] };
}

type QuoteResponse = undefined | { buyRate: string; sellRate: string };

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const RampResponse = object({
  quote: optional(object({ buyRate: string(), sellRate: string() })),
  depositInfo: array(
    variant("network", [
      object({
        network: literal("ARG_FIAT_TRANSFER"),
        depositAlias: optional(string()),
        cbu: string(),
        displayName: picklist(["CBU", "CVU"]),
        beneficiaryName: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("PIX"),
        pixKey: string(),
        displayName: literal("PIX KEY"),
        beneficiaryName: string(),
        postalCode: string(),
        merchantCity: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("PIX-BR"),
        brCode: string(),
        displayName: literal("PIX BR"),
        beneficiaryName: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("ACH"),
        displayName: literal("ACH"),
        beneficiaryName: string(),
        routingNumber: string(),
        accountNumber: string(),
        bankName: string(),
        bankAddress: string(),
        beneficiaryAddress: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("WIRE"),
        displayName: literal("WIRE"),
        beneficiaryName: string(),
        routingNumber: string(),
        accountNumber: string(),
        bankAddress: string(),
        bankName: string(),
        beneficiaryAddress: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("SEPA"), // cspell:ignore sepa
        displayName: literal("SEPA"),
        beneficiaryName: string(),
        iban: string(), // cspell:ignore iban
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("SPEI"), // cspell:ignore spei
        displayName: literal("SPEI"),
        beneficiaryName: string(),
        clabe: string(), // cspell:ignore clabe
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      ...bridge.EVMNetwork.map((network) =>
        object({
          network: literal(network),
          displayName: literal(network),
          address: Address,
          fee: string(),
          estimatedProcessingTime: string(),
        }),
      ),
      object({
        network: literal("OPTIMISM"),
        displayName: literal("Optimism"),
        address: Address,
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("TRON"),
        displayName: literal("TRON"),
        address: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("SOLANA"),
        displayName: literal("SOLANA"),
        address: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
      object({
        network: literal("STELLAR"),
        displayName: literal("STELLAR"),
        address: string(),
        fee: string(),
        estimatedProcessingTime: string(),
        memo: string(),
      }),
      object({
        network: literal("FASTER_PAYMENTS"),
        displayName: literal("Faster Payments"),
        accountNumber: string(),
        sortCode: string(),
        accountHolderName: string(),
        bankName: string(),
        bankAddress: string(),
        fee: string(),
        estimatedProcessingTime: string(),
      }),
    ]),
  ),
});

const ProviderStatus = picklist(["ACTIVE", "NOT_AVAILABLE", "NOT_STARTED", "ONBOARDING"]);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ProviderInfo = variant("provider", [
  object({
    provider: literal("manteca"),
    onramp: object({
      currencies: array(picklist(manteca.Currency)),
      limits: optional(
        object({
          monthly: object({ available: string(), limit: string(), symbol: string() }),
          yearly: object({ available: string(), limit: string(), symbol: string() }),
        }),
      ),
    }),
    status: ProviderStatus,
  }),
  object({
    provider: literal("bridge"),
    offramp: object({
      currencies: array(
        union([
          picklist(bridge.FiatCurrency),
          variant("currency", [
            object({ currency: literal("USDT"), network: literal("TRON") }),
            object({ currency: literal("USDC"), network: picklist(["BASE", "SOLANA", "STELLAR"]) }),
          ]),
        ]),
      ),
    }),
    onramp: object({
      currencies: array(
        union([
          picklist(bridge.FiatCurrency),
          variant("currency", [
            object({ currency: literal("USDT"), network: literal("TRON") }),
            object({ currency: literal("USDC"), network: picklist([...bridge.EVMNetwork, "SOLANA", "STELLAR"]) }),
          ]),
        ]),
      ),
    }),
    status: ProviderStatus,
    tosLink: optional(string()),
    kycLink: optional(string()),
  }),
]);
