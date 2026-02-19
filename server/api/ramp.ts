import { vValidator } from "@hono/valibot-validator";
import { captureException, setUser } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
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
import {
  SupportedCurrency as BridgeCurrency,
  ErrorCodes as BridgeErrorCodes,
  onboarding as bridgeOnboarding,
  getCryptoDepositDetails as getBridgeCryptoDepositDetails,
  getCustomer as getBridgeCustomer,
  getDepositDetails as getBridgeDepositDetails,
  getProvider as getBridgeProvider,
  getQuote as getBridgeQuote,
} from "../utils/ramps/bridge";
import {
  getDepositDetails as getMantecaDepositDetails,
  getProvider as getMantecaProvider,
  getQuote as getMantecaQuote,
  getUser as getMantecaUser,
  MantecaCurrency,
  ErrorCodes as MantecaErrorCodes,
  mantecaOnboarding,
} from "../utils/ramps/manteca";
import validatorHook from "../utils/validatorHook";

import type { DepositDetails, ProviderInfo, RampProvider } from "../utils/ramps/shared";

const debug = createDebug("exa:ramp");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const ErrorCodes = {
  ALREADY_CREATED: "already created",
  NO_CREDENTIAL: "no credential",
  NOT_STARTED: "not started",
  ONBOARDING: "onboarding",
  PENDING: "pending",
  ...MantecaErrorCodes,
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
        getMantecaProvider(account, countryCode).catch((error: unknown) => {
          captureException(error, { level: "error", contexts: { credential, params: { countryCode } } });
          return { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" as const };
        }),
        getBridgeProvider({
          credentialId,
          customerId: credential.bridgeId,
          countryCode,
          redirectURL,
        }).catch((error: unknown) => {
          captureException(error, { level: "error", contexts: { credential, params: { countryCode } } });
          return { onramp: { currencies: [], cryptoCurrencies: [] }, status: "NOT_AVAILABLE" as const };
        }),
      ]);

      return c.json(
        {
          manteca: mantecaProvider,
          bridge: bridgeProvider,
        } satisfies Record<(typeof RampProvider)[number], InferInput<typeof ProviderInfo>>,
        200,
      );
    },
  )
  .get(
    "/quote",
    auth(),
    vValidator(
      "query",
      union([
        object({ provider: literal("manteca"), currency: picklist(MantecaCurrency) }),
        object({ provider: literal("bridge"), currency: picklist(BridgeCurrency) }),
        object({ provider: literal("bridge"), cryptoCurrency: literal("USDT"), network: literal("TRON") }),
        object({ provider: literal("bridge"), cryptoCurrency: literal("USDC"), network: literal("SOLANA") }),
        object({ provider: literal("bridge"), cryptoCurrency: literal("USDC"), network: literal("STELLAR") }),
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
          const mantecaUser = await getMantecaUser(account);
          if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          try {
            depositInfo = getMantecaDepositDetails(query.currency, mantecaUser.exchange);
          } catch (error) {
            captureException(error, { level: "error", contexts: { credential } });
            if (error instanceof Error && Object.values(MantecaErrorCodes).includes(error.message)) {
              switch (error.message) {
                case MantecaErrorCodes.NOT_SUPPORTED_CURRENCY:
                  return c.json({ code: error.message }, 400);
              }
            }
            throw error;
          }
          return c.json({ quote: await getMantecaQuote(`USDC_${query.currency}`), depositInfo }, 200);
        }
        case "bridge": {
          if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
          const bridgeUser = await getBridgeCustomer(credential.bridgeId);
          if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);

          depositInfo = await ("cryptoCurrency" in query && "network" in query
            ? getBridgeCryptoDepositDetails(query.cryptoCurrency, query.network, credential.account, bridgeUser)
            : getBridgeDepositDetails(query.currency, credential.account, bridgeUser));

          return c.json(
            {
              quote: "currency" in query ? await getBridgeQuote(query.currency, query.currency) : undefined,
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
            await mantecaOnboarding(account, credentialId);
          } catch (error) {
            captureException(error, { level: "error", contexts: { credential } });
            if (error instanceof Error && Object.values(MantecaErrorCodes).includes(error.message)) {
              switch (error.message) {
                case MantecaErrorCodes.NO_DOCUMENT:
                  return c.json({ code: error.message }, 400);
                case MantecaErrorCodes.INVALID_LEGAL_ID: {
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
            await bridgeOnboarding({
              credentialId,
              customerId: credential.bridgeId,
              acceptedTermsId: onboarding.acceptedTermsId,
            });
          } catch (error) {
            captureException(error, { level: "error", contexts: { credential } });
            if (error instanceof Error && Object.values(BridgeErrorCodes).includes(error.message)) {
              switch (error.message) {
                case BridgeErrorCodes.ALREADY_ONBOARDED:
                  return c.json({ code: error.message }, 400);
                case BridgeErrorCodes.INVALID_ADDRESS: {
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
