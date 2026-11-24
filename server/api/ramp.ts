import { captureException, setUser } from "@sentry/core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import {
  array,
  literal,
  nonEmpty,
  object,
  optional,
  parse,
  picklist,
  pipe,
  safeParse,
  string,
  union,
  url,
  ValiError,
  variant,
  type BaseIssue,
  type InferInput,
  type InferOutput,
} from "valibot";
import { isAddressEqual, parseUnits } from "viem";

import { business } from "@exactly/common/tenants";
import { Address, Hash, Hex } from "@exactly/common/validation";

import { canRetry } from "./kyc";
import { credentials } from "../database/schema";
import { BusinessApplicationError } from "../utils/panda";
import {
  ADDRESS_TEMPLATE,
  isMissingOrNull,
  MANTECA_TEMPLATE_EXTRA_FIELDS,
  PANDA_TEMPLATE,
  syncing,
} from "../utils/persona";
import * as Bridge from "../utils/ramps/bridge";
import { decodeNonceKey, encodeNonceKey, findOperation } from "../utils/ramps/manteca";
import * as Manteca from "../utils/ramps/manteca";
import ServiceError from "../utils/ServiceError";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type createPersona from "../utils/persona";
import type createBridge from "../utils/ramps/bridge";
import type createManteca from "../utils/ramps/manteca";
import type createQR from "../workers/qr/queue";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

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
  NOT_SUPPORTED: "not supported",
  PAYMENT_NOT_EXECUTED: "payment not executed",
  PAYMENT_NOT_FOUND: "payment not found",
  POSTAL_CODE_REQUIRED: "postal code required",
  TRANSFER_NOT_FOUND: "transfer not found",
  WITHDRAWAL_IN_PROGRESS: "withdrawal in progress",
};

export default function route({
  auth,
  bridge,
  database,
  manteca,
  persona,
  qr,
  redis,
}: {
  auth: Auth;
  bridge: ReturnType<typeof createBridge>;
  database: NodePgDatabase<typeof schema>;
  manteca: ReturnType<typeof createManteca>;
  persona: ReturnType<typeof createPersona>;
  qr: ReturnType<typeof createQR>;
  redis: Redis;
}) {
  return new Hono()
    .get(
      "/",
      auth,
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
          columns: { account: true, bridgeId: true, salt: true },
        });
        if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
        const account = parse(Address, credential.account);
        setUser({ id: account });

        const redirectURL = c.req.valid("query").redirectURL;
        const accountType = parse(Address, credential.salt) === business ? "business" : "consumer";
        const [mantecaProvider, bridgeProvider] = await Promise.all([
          accountType === "business"
            ? { onramp: { currencies: [] }, status: "NOT_AVAILABLE" as const }
            : manteca.getProvider(account, countryCode).catch((error: unknown) => {
                captureException(error, { level: "error", contexts: { credential, params: { countryCode } } });
                return { onramp: { currencies: [] }, status: "NOT_AVAILABLE" as const };
              }),
          bridge
            .getProvider(
              {
                accountType,
                credentialId,
                customerId: credential.bridgeId,
                countryCode,
                redirectURL,
              },
              persona,
            )
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
      auth,
      vValidator(
        "query",
        variant("provider", [
          object({
            currency: picklist(Manteca.Currency),
            direction: optional(literal("onramp")),
            provider: literal("manteca"),
          }),
          object({ currency: picklist(["ARS", "BRL"]), direction: literal("qr"), provider: literal("manteca") }),
          object({
            currency: picklist(Bridge.FiatCurrency),
            direction: optional(literal("onramp")),
            provider: literal("bridge"),
          }),
          object({
            currency: picklist(Bridge.FiatCurrency),
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
            network: picklist([...Bridge.EVMNetwork, "SOLANA", "STELLAR"]),
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
            if (query.direction === "qr") {
              const [quote, min] = await Promise.all([
                manteca.getQuote(`USDC_${query.currency}`),
                manteca.getMinimum(),
              ]);
              return c.json({ quote: quote satisfies QuoteResponse, depositInfo: [], min }, 200);
            }
            const mantecaUser = await manteca.getUser(account);
            if (!mantecaUser) return c.json({ code: ErrorCodes.NOT_STARTED }, 400);
            if (mantecaUser.status !== "ACTIVE") return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);
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
              if (error instanceof Error && Object.values(Manteca.ErrorCodes).includes(error.message)) {
                switch (error.message) {
                  case Manteca.ErrorCodes.NOT_SUPPORTED_CURRENCY:
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
                  if (error instanceof Error && error.message === Bridge.ErrorCodes.INVALID_DEPOSIT_ADDRESS) {
                    return c.json({ code: ErrorCodes.INVALID_DEPOSIT_ADDRESS }, 400);
                  }
                  if (error instanceof Error && error.message === Bridge.ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL) {
                    return c.json({ code: ErrorCodes.NOT_SUPPORTED }, 400);
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
                if (error instanceof Error && error.message === Bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND) {
                  return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND }, 400);
                }
                if (error instanceof Error && error.message === Bridge.ErrorCodes.NOT_AVAILABLE_CURRENCY) {
                  return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_SUPPORTED }, 400);
                }
                if (error instanceof Error && error.message === Bridge.ErrorCodes.EXTERNAL_ACCOUNT_CURRENCY_MISMATCH) {
                  return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_CURRENCY_MISMATCH }, 400);
                }
                if (error instanceof Error && error.message === Bridge.ErrorCodes.OFFRAMP_TRANSFER_NOT_FOUND) {
                  return c.json({ code: ErrorCodes.TRANSFER_NOT_FOUND }, 400);
                }
                if (error instanceof Error && error.message === Bridge.ErrorCodes.TRANSFER_IN_USE) {
                  return c.json({ code: ErrorCodes.WITHDRAWAL_IN_PROGRESS }, 400);
                }
                throw error;
              }
            }

            if ("network" in query) {
              try {
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
              } catch (error) {
                if (error instanceof Error && error.message === Bridge.ErrorCodes.NOT_AVAILABLE_CRYPTO_PAYMENT_RAIL) {
                  return c.json({ code: ErrorCodes.NOT_SUPPORTED }, 400);
                }
                throw error;
              }
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
      auth,
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
          columns: { account: true, bridgeId: true, salt: true },
        });
        if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
        const account = parse(Address, credential.account);
        setUser({ id: account });

        const accountType = parse(Address, credential.salt) === business ? "business" : "consumer";
        switch (onboarding.provider) {
          case "manteca":
            if (accountType === "business") return c.json({ code: ErrorCodes.NOT_SUPPORTED }, 400);
            try {
              await manteca.onboarding(account, credentialId, persona);
            } catch (error) {
              captureException(error, { level: "error", contexts: { credential } });
              if (error instanceof Error && Object.values(Manteca.ErrorCodes).includes(error.message)) {
                switch (error.message) {
                  case Manteca.ErrorCodes.NO_DOCUMENT:
                    return c.json({ code: error.message }, 400);
                  case Manteca.ErrorCodes.INVALID_LEGAL_ID: {
                    const { inquiryId, sessionToken } = await getOrCreateInquiry(
                      credentialId,
                      MANTECA_TEMPLATE_EXTRA_FIELDS,
                      persona,
                      await persona.getInquiry(credentialId, MANTECA_TEMPLATE_EXTRA_FIELDS),
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
              await bridge.onboarding(
                {
                  accountType,
                  acceptedTermsId: onboarding.acceptedTermsId,
                  credentialId,
                  customerId: credential.bridgeId,
                },
                database,
                persona,
              );
            } catch (error) {
              if (error instanceof BusinessApplicationError) return c.json({ code: error.code }, 400);
              const inquiry =
                error instanceof Error &&
                (error.message === Bridge.ErrorCodes.MISSING_FIELDS ||
                  (error.message === Bridge.ErrorCodes.NOT_ENABLED && error.cause === Bridge.ErrorCodes.MISSING_FIELDS))
                  ? await persona
                      .getLatestInquiry(credentialId, PANDA_TEMPLATE)
                      .catch((personaError: unknown): undefined => {
                        if (error.message !== Bridge.ErrorCodes.NOT_ENABLED) throw personaError;
                        captureException(personaError, { level: "error", contexts: { credential } });
                      })
                  : undefined;
              if (syncing(inquiry)) return c.json({ code: "pending" }, 200);
              if (!(error instanceof Error && error.message === Bridge.ErrorCodes.MISSING_FIELDS)) {
                captureException(error, { level: "error", contexts: { credential } });
              }
              if (error instanceof ServiceError && error.status === 422)
                return c.json({ code: ErrorCodes.NOT_SUPPORTED }, 400);
              if (error instanceof Error && Object.values(Bridge.ErrorCodes).includes(error.message)) {
                switch (error.message) {
                  case Bridge.ErrorCodes.ALREADY_ONBOARDED:
                  case Bridge.ErrorCodes.DENYLISTED_COUNTRY:
                  case Bridge.ErrorCodes.EMAIL_ALREADY_EXISTS:
                  case Bridge.ErrorCodes.NOT_ENABLED:
                  case Bridge.ErrorCodes.NOT_SUPPORTED_ACCOUNT_TYPE:
                  case Bridge.ErrorCodes.NOT_SUPPORTED_CHAIN_ID:
                    return c.json({ code: error.message }, 400);
                  case Bridge.ErrorCodes.INVALID_ADDRESS: {
                    const { inquiryId, sessionToken } = await getOrCreateInquiry(
                      credentialId,
                      ADDRESS_TEMPLATE,
                      persona,
                      await persona.getInquiry(credentialId, ADDRESS_TEMPLATE),
                    );
                    return c.json({ code: error.message, inquiryId, sessionToken }, 400);
                  }
                  case Bridge.ErrorCodes.MISSING_FIELDS: {
                    if (inquiry?.attributes.status === "completed" || inquiry?.attributes.status === "needs_review") {
                      return c.json({ code: "pending" }, 200);
                    }
                    if (
                      inquiry?.attributes.status === "declined" ||
                      (inquiry?.attributes.status === "failed" &&
                        !(await canRetry(credentialId, PANDA_TEMPLATE, persona)))
                    ) {
                      return c.json({ code: "failed" }, 400);
                    }
                    const { inquiryId, sessionToken } = await getOrCreateInquiry(
                      credentialId,
                      PANDA_TEMPLATE,
                      persona,
                      inquiry,
                    );
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
    .post(
      "/qr",
      auth,
      describeRoute({
        summary: "Lock QR payment",
        description: `
Lock the payment of a merchant QR code for the authenticated user, with the national id of the user as sender.

Send the \`amount\` in the currency of the QR when the QR has none. Without it, such a QR returns \`206\` with the recipient only.

Pay the lock with a user operation that withdraws at least \`amount\` USDC to \`receiver\` before \`expireAt\`, using \`nonceKey\` as the key of its nonce. The server executes the payment once the withdraw is onchain.

A lock whose \`amount\` is below the minimum order returns \`400\` with \`invalid order size\`, since its payment could never execute.
        `,
        tags: ["QR"],
        security: [{ credentialAuth: [] }],
        validateResponse: true,
        responses: {
          200: {
            description: "Locked payment",
            content: { "application/json": { schema: resolver(QRLock, { errorMode: "ignore" }) } },
          },
          206: {
            description: "QR without amount",
            content: {
              "application/json": {
                schema: resolver(object({ recipient: optional(string()), asset: string() }), { errorMode: "ignore" }),
              },
            },
          },
          400: {
            description: "Bad request",
            content: {
              "application/json": {
                schema: resolver(
                  object({
                    code: picklist([
                      "bad qr",
                      ErrorCodes.NO_CREDENTIAL,
                      ErrorCodes.NOT_SUPPORTED,
                      Manteca.ErrorCodes.INVALID_AMOUNT,
                      Manteca.ErrorCodes.INVALID_ORDER_SIZE,
                      Manteca.ErrorCodes.INVALID_QR,
                      Manteca.ErrorCodes.NO_DOCUMENT,
                      Manteca.ErrorCodes.NO_PERSONA_ACCOUNT,
                    ]),
                  }),
                  { errorMode: "ignore" },
                ),
              },
            },
          },
        },
      }),
      vValidator(
        "json",
        object({ qr: string(), amount: optional(pipe(string(), nonEmpty())) }),
        validatorHook({ code: "bad qr" }),
      ),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const payment = c.req.valid("json");
        const credential = await database.query.credentials.findFirst({
          where: eq(credentials.id, credentialId),
          columns: { account: true, salt: true },
        });
        if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
        const account = parse(Address, credential.account);
        setUser({ id: account });
        if (parse(Address, credential.salt) === business) return c.json({ code: ErrorCodes.NOT_SUPPORTED }, 400);

        const personaAccount = await persona.getAccount(credentialId, "basic").catch((error: unknown) => {
          if (error instanceof ValiError && error.issues.every((issue: BaseIssue<unknown>) => isMissingOrNull(issue))) {
            return;
          }
          throw error;
        });
        if (!personaAccount) return c.json({ code: Manteca.ErrorCodes.NO_PERSONA_ACCOUNT }, 400);
        const document = personaAccount.attributes.fields.documents.value.find(
          ({ value }) => value.id_class.value === "id" && value.id_issuing_country.value === "AR",
        )?.value;
        if (!document) return c.json({ code: Manteca.ErrorCodes.NO_DOCUMENT }, 400);
        try {
          const lock = await manteca.lockQRPayment({
            paymentDestination: payment.qr,
            amount: payment.amount,
            against: "USDC",
            sender: {
              legalIdNationality: document.id_issuing_country.value,
              legalId: document.id_number.value,
              name: personaAccount.attributes.fields.name.value.first.value,
              surname: personaAccount.attributes.fields.name.value.last.value,
            },
          });
          if (!lock.code) return c.json({ recipient: lock.paymentRecipientName, asset: lock.paymentAsset }, 206);
          if (!lock.sender) throw new Error("lock without sender");
          const [min, receiver] = await Promise.all([manteca.getMinimum(), manteca.getSettlement(lock.paymentAsset)]);
          if (min && parseUnits(lock.paymentAgainstAmount, 8) < parseUnits(min, 8)) {
            return c.json({ code: Manteca.ErrorCodes.INVALID_ORDER_SIZE }, 400);
          }
          await redis.set(
            `qr:${lock.code}`,
            JSON.stringify({
              account,
              amount: lock.paymentAgainstAmount,
              asset: lock.paymentAsset,
              expireAt: lock.expireAt,
            }),
            "EX",
            8 * 24 * 60 * 60,
          );
          return c.json(
            {
              code: lock.code,
              nonceKey: encodeNonceKey(lock.code),
              amount: lock.paymentAgainstAmount,
              expireAt: lock.expireAt,
              recipient: lock.paymentRecipientName,
              receiver,
              asset: lock.paymentAsset,
              assetAmount: lock.paymentAssetAmount,
              price: lock.paymentPrice,
            } satisfies InferOutput<typeof QRLock>,
            200,
          );
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message === Manteca.ErrorCodes.INVALID_AMOUNT || error.message === Manteca.ErrorCodes.INVALID_QR)
          ) {
            return c.json({ code: error.message }, 400);
          }
          throw error;
        }
      },
    )
    .get(
      "/qr/:userOpHash",
      auth,
      describeRoute({
        summary: "Get QR payment",
        description: `
Retrieve the status of the QR payment made by the user operation \`userOpHash\` of the authenticated user.

Returns the synthetic of the payment once the server executed it, or \`FAILED\` when the user operation reverted. When the lock expired before the execution, the server refunds the payment to the account, and returns \`REFUNDING\` until the refund is sent, \`REFUNDED\` once it is, or \`EXPIRED\` without a refund.
        `,
        tags: ["QR"],
        security: [{ credentialAuth: [] }],
        validateResponse: true,
        responses: {
          200: {
            description: "Payment status",
            content: { "application/json": { schema: resolver(QRPayment, { errorMode: "ignore" }) } },
          },
          400: {
            description: "Bad request",
            content: {
              "application/json": {
                schema: resolver(object({ code: picklist(["bad request", ErrorCodes.NO_CREDENTIAL]) }), {
                  errorMode: "ignore",
                }),
              },
            },
          },
          404: {
            description: "Payment not found or not executed",
            content: {
              "application/json": {
                schema: resolver(
                  object({ code: picklist([ErrorCodes.PAYMENT_NOT_EXECUTED, ErrorCodes.PAYMENT_NOT_FOUND]) }),
                  { errorMode: "ignore" },
                ),
              },
            },
          },
        },
      }),
      vValidator("param", object({ userOpHash: Hash }), validatorHook()),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const { userOpHash } = c.req.valid("param");
        const credential = await database.query.credentials.findFirst({
          where: eq(credentials.id, credentialId),
          columns: { account: true },
        });
        if (!credential) return c.json({ code: ErrorCodes.NO_CREDENTIAL }, 400);
        const account = parse(Address, credential.account);
        setUser({ id: account });

        const operation = await findOperation(userOpHash);
        if (!operation || !isAddressEqual(operation.sender, account)) {
          return c.json({ code: ErrorCodes.PAYMENT_NOT_FOUND }, 404);
        }
        const code = decodeNonceKey(BigInt(operation.nonce)); // eslint-disable-line @typescript-eslint/no-unnecessary-type-conversion -- viem keeps the rpc hex
        if (!code) return c.json({ code: ErrorCodes.PAYMENT_NOT_FOUND }, 404);
        if (!operation.success) return c.json({ status: "FAILED" } satisfies InferOutput<typeof QRPayment>, 200);
        const lock = await manteca.getPaymentLock(code);
        const synthetic = await manteca.getSynthetic(userOpHash);
        if (synthetic) {
          return c.json({ id: synthetic.id, status: synthetic.status } satisfies InferOutput<typeof QRPayment>, 200);
        }
        if (!lock) {
          const refund = await manteca.getQRRefund(userOpHash);
          if (refund) {
            return c.json({ status: RefundStatus[refund.status] } satisfies InferOutput<typeof QRPayment>, 200);
          }
          const record = safeParse(Manteca.QRRecord, await redis.get(`qr:${code}`));
          const pending = (await qr.getJob(userOpHash)) && record.success && record.output.account === account;
          return c.json({ status: pending ? "REFUNDING" : "EXPIRED" } satisfies InferOutput<typeof QRPayment>, 200);
        }
        return c.json({ code: ErrorCodes.PAYMENT_NOT_EXECUTED }, 404);
      },
    )
    .post("/external-account", auth, vValidator("json", Bridge.ExternalAccountInput, validatorHook()), async (c) => {
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

      const payload = c.req.valid("json");
      try {
        const externalAccount = await bridge.createExternalAccount(bridgeUser, payload);
        await bridge.createOfframpTransfer(
          bridgeUser.id,
          credential.account,
          externalAccount.id,
          externalAccount.currency,
          payload.currency === "USD" ? payload.rail : undefined,
          payload.reference,
        );
        return c.json(externalAccount, 200);
      } catch (error) {
        if (error instanceof Error && error.message === Bridge.ErrorCodes.NO_ENDORSEMENT) {
          return c.json({ code: ErrorCodes.NOT_APPROVED }, 400);
        }
        if (error instanceof Error && error.message === Bridge.ErrorCodes.INVALID_BANK_NAME) {
          return c.json({ code: ErrorCodes.INVALID_BANK_NAME }, 400);
        }
        if (error instanceof Error && error.message === Bridge.ErrorCodes.POSTAL_CODE_REQUIRED) {
          return c.json({ code: ErrorCodes.POSTAL_CODE_REQUIRED }, 400);
        }
        if (error instanceof Error && error.message === Bridge.ErrorCodes.EXTERNAL_ACCOUNT_ALREADY_EXISTS) {
          return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_ALREADY_EXISTS }, 400);
        }
        throw error;
      }
    })
    .get("/external-account", auth, async (c) => {
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
      auth,
      vValidator("param", object({ id: string() }), validatorHook()),
      vValidator("json", Bridge.UpdateExternalAccountInput, validatorHook()),
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
          if (error instanceof Error && error.message === Bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND) {
            return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND }, 400);
          }
          throw error;
        }
      },
    )
    .delete(
      "/external-account/:id",
      auth,
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
          if (error instanceof Error && error.message === Bridge.ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND) {
            return c.json({ code: ErrorCodes.EXTERNAL_ACCOUNT_NOT_FOUND }, 400);
          }
          if (error instanceof Error && error.message === Bridge.ErrorCodes.TRANSFER_IN_USE) {
            return c.json({ code: ErrorCodes.WITHDRAWAL_IN_PROGRESS }, 400);
          }
          throw error;
        }
        return c.json({ code: "ok" }, 200);
      },
    );
}

async function getOrCreateInquiry(
  credentialId: string,
  template: string,
  persona: ReturnType<typeof createPersona>,
  existing: Awaited<ReturnType<ReturnType<typeof createPersona>["getInquiry"]>>,
) {
  const { data: inquiry } =
    existing?.attributes.status === "created" ||
    existing?.attributes.status === "pending" ||
    existing?.attributes.status === "expired"
      ? { data: { id: existing.id } }
      : await persona.createInquiry(credentialId, template);
  const { meta } = await persona.resumeInquiry(inquiry.id);
  return { inquiryId: inquiry.id, sessionToken: meta["session-token"] };
}

type QuoteResponse = undefined | { buyRate: string; sellRate: string };

const QRLock = object({
  code: string(),
  nonceKey: Hex,
  amount: string(),
  expireAt: string(),
  recipient: optional(string()),
  receiver: Address,
  asset: string(),
  assetAmount: string(),
  price: optional(string()),
});

const QRPayment = union([
  object({ id: string(), status: picklist(Manteca.SyntheticStatus) }),
  object({ status: picklist(["EXPIRED", "FAILED", "REFUNDING", "REFUNDED"]) }),
]);

const RefundStatus = { PENDING: "REFUNDING", EXECUTED: "REFUNDED", CANCELLED: "EXPIRED" } as const;

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
      ...Bridge.EVMNetwork.map((network) =>
        object({
          network: literal(network),
          displayName: literal(network),
          address: Address,
          fee: string(),
          estimatedProcessingTime: string(),
        }),
      ),
      object({
        network: picklist(["BASE", "OPTIMISM"]),
        displayName: picklist(["Base", "Optimism"]),
        address: Address,
        fee: string(),
        estimatedProcessingTime: string(),
        rail: optional(picklist(["ach", "wire"])),
        reference: optional(string()),
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

const ProviderStatus = picklist(["ACTIVE", "CONTACT_SUPPORT", "NOT_AVAILABLE", "NOT_STARTED", "ONBOARDING"]);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const ProviderInfo = variant("provider", [
  object({
    provider: literal("manteca"),
    onramp: object({
      currencies: array(picklist(Manteca.Currency)),
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
          picklist(Bridge.FiatCurrency),
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
          picklist(Bridge.FiatCurrency),
          variant("currency", [
            object({ currency: literal("USDT"), network: literal("TRON") }),
            object({ currency: literal("USDC"), network: picklist([...Bridge.EVMNetwork, "SOLANA", "STELLAR"]) }),
          ]),
        ]),
      ),
    }),
    status: ProviderStatus,
    tosLink: optional(string()),
    kycLink: optional(string()),
    futureRequirement: optional(object({ url: string(), date: string() })),
  }),
]);
