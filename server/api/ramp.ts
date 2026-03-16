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
  string,
  union,
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
  NO_CREDENTIAL: "no credential",
  NOT_STARTED: "not started",
};

export default new Hono()
  .get(
    "/",
    auth(),
    vValidator("query", object({ countryCode: optional(string()), redirectURL: optional(string()) }), validatorHook()),
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
            return { onramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
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
        object({ provider: literal("manteca"), currency: picklist(manteca.Currency) }),
        object({ provider: literal("bridge"), currency: picklist(bridge.FiatCurrency) }),
        object({ provider: literal("bridge"), currency: literal("USDT"), network: literal("TRON") }),
        object({ provider: literal("bridge"), currency: literal("USDC"), network: literal("SOLANA") }),
        object({ provider: literal("bridge"), currency: literal("USDC"), network: literal("STELLAR") }),
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

      let depositInfo: InferOutput<typeof DepositDetails>[];
      switch (query.provider) {
        case "manteca": {
          const mantecaUser = await manteca.getUser(account);
          if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          try {
            depositInfo = manteca.getDepositDetails(query.currency, mantecaUser.exchange);
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
          return c.json(
            {
              quote: (await manteca.getQuote(`USDC_${query.currency}`)) satisfies QuoteResponse,
              depositInfo,
            },
            200,
          );
        }
        case "bridge": {
          if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          const bridgeUser = await bridge.getCustomer(credential.bridgeId);
          if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);

          depositInfo = await ("currency" in query && "network" in query
            ? bridge.getCryptoDepositDetails(query.currency, query.network, credential.account, bridgeUser)
            : bridge.getDepositDetails(query.currency, credential.account, bridgeUser));

          return c.json(
            {
              quote: ("currency" in query && "network" in query
                ? undefined
                : await bridge.getQuote("USD", query.currency)) satisfies QuoteResponse,
              depositInfo,
            },
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
const DepositDetails = variant("network", [
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
]);

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
    onramp: object({
      currencies: array(
        union([
          picklist(bridge.FiatCurrency),
          variant("currency", [
            object({ currency: literal("USDT"), network: literal("TRON") }),
            object({ currency: literal("USDC"), network: literal("SOLANA") }),
            object({ currency: literal("USDC"), network: literal("STELLAR") }),
          ]),
        ]),
      ),
    }),
    status: ProviderStatus,
    tosLink: optional(string()),
  }),
]);
