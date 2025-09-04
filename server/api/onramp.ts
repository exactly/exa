import { vValidator } from "@hono/valibot-validator";
import { captureException, setUser } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  literal,
  object,
  optional,
  picklist,
  string,
  union,
  variant,
  type InferInput,
  type InferOutput,
} from "valibot";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import { PANDA_TEMPLATE } from "../utils/persona";
import {
  getDepositDetails as getBridgeDepositDetails,
  SupportedCurrency as BridgeCurrency,
  getCustomer as getBridgeCustomer,
  getProvider as getBridgeProvider,
  onboarding as bridgeOnboarding,
  getQuote as getBridgeQuote,
  ErrorCodes as BridgeErrorCodes,
  getCryptoDepositDetails as getBridgeCryptoDepositDetails,
  SupportedCrypto as SupportedBridgeCrypto,
} from "../utils/ramps/bridge";
import {
  getProvider as getMantecaProvider,
  ErrorCodes as MantecaErrorCodes,
  getDepositDetails as getMantecaDepositDetails,
  getLimits as getMantecaLimits,
  getQuote as getMantecaQuote,
  getUser as getMantecaUser,
  mantecaOnboarding,
  MantecaCurrency,
} from "../utils/ramps/manteca";
import { CryptoNetwork, type DepositDetails, type ProviderInfo, type RampProvider } from "../utils/ramps/shared";
import validatorHook from "../utils/validatorHook";

const debug = createDebug("exa:onramp");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const ErrorCodes = {
  ALREADY_CREATED: "already created",
  NO_CREDENTIAL: "no credential",
  NOT_STARTED: "not started",
  ONBOARDING: "onboarding",
  PENDING: "pending",
  ...MantecaErrorCodes,
};

const GetProviderQuery = object({
  templateId: optional(string()),
  countryCode: optional(string()),
  redirectURL: optional(string()),
});

const GetQuoteQuery = union([
  object({ provider: literal("manteca"), currency: picklist(MantecaCurrency) }),
  object({ provider: literal("bridge"), currency: picklist(BridgeCurrency) }),
  object({
    provider: literal("bridge"),
    cryptoCurrency: picklist(SupportedBridgeCrypto),
    network: picklist(CryptoNetwork),
  }),
]);

const Onboarding = variant("provider", [
  object({ provider: literal("bridge"), acceptedTermsId: string() }),
  object({ provider: literal("manteca") }),
]);

export default new Hono()
  .get("/", auth(), vValidator("query", GetProviderQuery, validatorHook()), async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const templateId = c.req.valid("query").templateId ?? PANDA_TEMPLATE;
    const countryCode = c.req.valid("query").countryCode;
    if (templateId !== PANDA_TEMPLATE) {
      return c.json({ code: "bad template", legacy: "invalid persona template" }, 400);
    }
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, bridgeId: true },
    });
    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
    setUser({ id: credential.account });

    const redirectURL = c.req.valid("query").redirectURL;
    const [mantecaProvider, bridgeProvider] = await Promise.all([
      getMantecaProvider(credential.account, credentialId, templateId, countryCode, redirectURL).catch(
        (error: unknown) => {
          captureException(error, { contexts: { credential, params: { templateId, countryCode } } });
          return { status: "NOT_AVAILABLE" as const, currencies: [], cryptoCurrencies: [], pendingTasks: [] };
        },
      ),
      getBridgeProvider({
        credentialId,
        templateId,
        customerId: credential.bridgeId,
        countryCode,
        redirectURL,
      }).catch((error: unknown) => {
        captureException(error, { contexts: { credential, params: { templateId, countryCode } } });
        return { status: "NOT_AVAILABLE" as const, currencies: [], cryptoCurrencies: [], pendingTasks: [] };
      }),
    ]);

    const providers: Record<(typeof RampProvider)[number], InferInput<typeof ProviderInfo>> = {
      manteca: {
        status: mantecaProvider.status,
        currencies: mantecaProvider.currencies,
        cryptoCurrencies: mantecaProvider.cryptoCurrencies,
        pendingTasks: mantecaProvider.pendingTasks,
      },
      bridge: {
        status: bridgeProvider.status,
        currencies: bridgeProvider.currencies,
        cryptoCurrencies: bridgeProvider.cryptoCurrencies,
        pendingTasks: bridgeProvider.pendingTasks,
      },
    };
    return c.json({ providers });
  })
  .get("/limits", auth(), async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true },
    });

    // TODO support multiple providers

    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
    setUser({ id: credential.account });
    const mantecaUser = await getMantecaUser(credential.account.replace("0x", ""));
    if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
    if (mantecaUser.status !== "ACTIVE") return c.json({ code: ErrorCodes.PENDING }, 400);
    const limits = await getMantecaLimits(mantecaUser.numberId);

    return c.json({ manteca: { limits } });
  })
  .get("/quote", auth(), vValidator("query", GetQuoteQuery, validatorHook()), async (c) => {
    const query = c.req.valid("query");
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: { account: true, bridgeId: true },
    });
    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
    setUser({ id: credential.account });

    let depositInfo: InferOutput<typeof DepositDetails>[];
    switch (query.provider) {
      case "manteca": {
        const mantecaUser = await getMantecaUser(credential.account.replace("0x", ""));
        if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
        try {
          depositInfo = getMantecaDepositDetails(query.currency, mantecaUser.exchange);
        } catch (error) {
          captureException(error, { contexts: { credential } });
          if (error instanceof Error && Object.values(MantecaErrorCodes).includes(error.message)) {
            return c.json({ code: error.message }, 400);
          }
          throw error;
        }
        depositInfo = getMantecaDepositDetails(query.currency, mantecaUser.exchange);
        return c.json({ quote: await getMantecaQuote(`USDC_${query.currency}`), depositInfo });
      }
      case "bridge": {
        if (!credential.bridgeId) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
        const bridgeUser = await getBridgeCustomer(credential.bridgeId);
        if (!bridgeUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);

        try {
          depositInfo =
            "cryptoCurrency" in query && "network" in query
              ? await getBridgeCryptoDepositDetails(query.cryptoCurrency, query.network, credential.account, bridgeUser)
              : await getBridgeDepositDetails(query.currency, credential.account, bridgeUser);
        } catch (error) {
          captureException(error, { contexts: { credential } });
          if (error instanceof Error && Object.values(BridgeErrorCodes).includes(error.message)) {
            return c.json({ code: error.message }, 400);
          }
          throw error;
        }

        return c.json({
          quote: "currency" in query ? await getBridgeQuote(query.currency, query.currency) : undefined,
          depositInfo,
        });
      }
    }
  })
  .post(
    "/onboarding",
    auth(),
    vValidator("query", object({ templateId: optional(string()) }), validatorHook({ code: "bad query" })),
    vValidator("json", Onboarding, validatorHook({ code: "bad onboarding" })),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const onboarding = c.req.valid("json");
      const templateId = c.req.valid("query").templateId ?? PANDA_TEMPLATE;
      if (templateId !== PANDA_TEMPLATE) {
        return c.json({ code: "bad template", legacy: "invalid persona template" }, 400);
      }
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: { account: true, bridgeId: true },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
      setUser({ id: credential.account });

      switch (onboarding.provider) {
        case "manteca":
          try {
            await mantecaOnboarding(credential.account, credentialId, templateId);
          } catch (error) {
            captureException(error, { contexts: { credential } });
            if (error instanceof Error && Object.values(MantecaErrorCodes).includes(error.message)) {
              switch (error.message) {
                case MantecaErrorCodes.COUNTRY_NOT_ALLOWED:
                case MantecaErrorCodes.ID_NOT_ALLOWED:
                case MantecaErrorCodes.BAD_KYC_ADDITIONAL_DATA:
                  return c.json({ code: error.message }, 400);
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
              templateId,
              acceptedTermsId: onboarding.acceptedTermsId,
            });
          } catch (error) {
            captureException(error, { contexts: { credential } });
            if (error instanceof Error && Object.values(BridgeErrorCodes).includes(error.message)) {
              switch (error.message) {
                case BridgeErrorCodes.ALREADY_ONBOARDED:
                  return c.json({ code: error.message }, 400);
              }
            }
            throw error;
          }
          break;
      }
      return c.json({ code: "ok" });
    },
  );
