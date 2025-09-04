import { vValidator } from "@hono/valibot-validator";
import { captureException } from "@sentry/core";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as v from "valibot";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import { CRYPTOMATE_TEMPLATE, PANDA_TEMPLATE } from "../utils/persona";
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
import type { DepositDetails } from "../utils/ramps/shared";
import { RampProvider } from "../utils/ramps/shared";
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

const ProviderStatus = ["NOT_STARTED", "ACTIVE", "ONBOARDING", "NOT_AVAILABLE", "MISSING_INFORMATION"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ProviderInfo = v.object({
  status: v.picklist(ProviderStatus),
  currencies: v.array(v.string()),
});

const GetQuoteQuery = v.variant("provider", [
  v.object({
    provider: v.literal("manteca"),
    currency: v.picklist(MantecaCurrency),
  }),
]);

const Onboarding = v.variant("provider", [
  v.object({
    provider: v.picklist(RampProvider),
  }),
]);

export default new Hono()
  .get(
    "/",
    auth(),
    vValidator(
      "query",
      v.object({ templateId: v.optional(v.string()), countryCode: v.optional(v.string()) }),
      validatorHook(),
    ),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const templateId = c.req.valid("query").templateId ?? CRYPTOMATE_TEMPLATE;
      const countryCode = c.req.valid("query").countryCode;
      if (templateId !== CRYPTOMATE_TEMPLATE && templateId !== PANDA_TEMPLATE) {
        return c.json({ code: "bad template", legacy: "invalid persona template" }, 400);
      }
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: {
          account: true,
        },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);

      // TODO handle errors
      const mantecaProvider = await getMantecaProvider(credential.account, credentialId, templateId, countryCode);

      const providers: Record<(typeof RampProvider)[number], v.InferInput<typeof ProviderInfo>> = {
        manteca: {
          status: mantecaProvider.status,
          currencies: mantecaProvider.currencies,
        },
      };
      return c.json({ providers });
    },
  )
  .get("/limits", auth(), async (c) => {
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: {
        account: true,
      },
    });

    // TODO support multiple providers

    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
    const mantecaUser = await getMantecaUser(credential.account.replace("0x", ""));
    if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
    if (mantecaUser.status !== "ACTIVE") return c.json({ code: ErrorCodes.PENDING }, 400);
    const limits = await getMantecaLimits(mantecaUser.numberId);

    return c.json({ manteca: { limits } });
  })
  .get("/quote", auth(), vValidator("query", GetQuoteQuery, validatorHook()), async (c) => {
    const query = c.req.valid("query");
    let depositInfo: v.InferOutput<typeof DepositDetails> | undefined;
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, credentialId),
      columns: {
        account: true,
      },
    });
    if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);

    switch (query.provider) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      case "manteca": {
        const mantecaUser = await getMantecaUser(credential.account.replace("0x", ""));
        if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
        depositInfo = getMantecaDepositDetails(query.currency, mantecaUser.exchange);
        return c.json({ quote: await getMantecaQuote(`USDC_${query.currency}`), depositInfo });
      }
    }
    return c.json({ code: "bad provider" }, 400);
  })
  .post(
    "/onboarding",
    auth(),
    vValidator("query", v.object({ templateId: v.optional(v.string()) }), validatorHook({ code: "bad query" })),
    vValidator("json", Onboarding, validatorHook({ code: "bad onboarding" })),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const onboarding = c.req.valid("json");
      const templateId = c.req.valid("query").templateId ?? CRYPTOMATE_TEMPLATE;
      if (templateId !== CRYPTOMATE_TEMPLATE && templateId !== PANDA_TEMPLATE) {
        return c.json({ code: "bad template", legacy: "invalid persona template" }, 400);
      }
      const credential = await database.query.credentials.findFirst({
        where: eq(credentials.id, credentialId),
        columns: {
          account: true,
        },
      });
      if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);

      switch (onboarding.provider) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        case "manteca":
          try {
            await mantecaOnboarding(credential.account, credentialId, templateId);
          } catch (error) {
            captureException(error, { contexts: { credential } });
            if (error instanceof Error && Object.values(ErrorCodes).includes(error.message)) {
              switch (error.message) {
                case ErrorCodes.COUNTRY_NOT_ALLOWED:
                case ErrorCodes.ID_NOT_ALLOWED:
                case ErrorCodes.BAD_KYC_ADDITIONAL_DATA:
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
