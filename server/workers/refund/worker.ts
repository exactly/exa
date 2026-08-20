import { captureException, setUser } from "@sentry/node";
import { UnrecoverableError } from "bullmq";
import { and, eq } from "drizzle-orm";
import { number, object, parse, string } from "valibot";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  parseAbi,
  toFunctionSelector,
  toHex,
  type LocalAccount,
} from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, {
  issuerCheckerAbi,
  marketAbi,
  refunderAbi,
  refunderAddress as refunderContract,
  simple7702AccountAddress,
} from "@exactly/common/generated/chain";
import revertReason from "@exactly/common/revertReason";
import { Address, Hex } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import { cards, transactions } from "../../database/schema";
import t, { f } from "../../i18n";
import { TransactionPayload } from "../../utils/panda";
import revertFingerprint from "../../utils/revertFingerprint";
import createWallet from "../../utils/wallet";
import { name as hookName } from "../hook/job";
import createHook from "../hook/queue";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type createOnesignal from "../../utils/onesignal";
import type createPanda from "../../utils/panda";
import type createSardine from "../../utils/sardine";
import type createSegment from "../../utils/segment";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

export default function worker({
  bullmq,
  close,
  database,
  onesignal,
  panda,
  refunder,
  sardine,
  segment,
}: {
  bullmq: Redis;
  close: () => Promise<unknown>;
  database: NodePgDatabase<typeof schema>;
  onesignal: ReturnType<typeof createOnesignal>;
  panda: ReturnType<typeof createPanda>;
  refunder: LocalAccount;
  sardine: ReturnType<typeof createSardine>;
  segment: ReturnType<typeof createSegment>;
}) {
  const wallet = createWallet(refunder);
  const hook = createHook(bullmq);
  const abi = [...issuerCheckerAbi, ...marketAbi, ...refunderAbi];
  return createWorker<Job>({
    attempts,
    bullmq,
    close: () => hook.close().finally(close),
    failed(job, raw) {
      const error = raw instanceof UnrecoverableError && raw.cause instanceof Error ? raw.cause : raw;
      const reason = revertReason(error, { fallback: "message" });
      const reasonName = revertReason(error, { fallback: "name" });
      captureException(error, {
        extra: { attempts: job?.attemptsMade, id: job?.id, recipient: refunderContract },
        level: "fatal",
        fingerprint: ["{{ default }}", "refund.exhausted", ...revertFingerprint(error).slice(1)],
        tags: { queue: name, job: job?.name, "panda.reason": reason, "panda.reasonName": reasonName },
      });
      if (!job) return;
      panda
        .getWebhook(parse(string(), job.id))
        .then(async ({ requestBody }) => {
          if (requestBody.resource !== "transaction") return;
          if (requestBody.action !== "completed" && requestBody.action !== "updated") return;
          const card = await database.query.cards.findFirst({
            columns: { mode: true },
            where: eq(cards.id, requestBody.body.spend.cardId),
            with: { credential: { columns: { source: true } } },
          });
          if (!card) return;
          segment.track({
            userId: job.data.account,
            event: "TransactionRejected",
            properties: {
              cardMode: card.mode,
              declinedReason: `refund:${reason}`,
              id: requestBody.body.id,
              reasonName,
              source: card.credential.source,
              updated: requestBody.action === "updated",
              usdAmount: requestBody.body.spend.amount / 100,
              merchant: {
                name: requestBody.body.spend.merchantName,
                category: requestBody.body.spend.merchantCategory,
                city: requestBody.body.spend.merchantCity,
                country: requestBody.body.spend.merchantCountry,
              },
            },
          });
        })
        .catch((error_: unknown) => captureException(error_, { level: "error" }));
    },
    name,
    ready: wallet.getDelegation({ address: refunder.address }).then(async (delegation) => {
      if (delegation === simple7702AccountAddress) return;
      const authorization = await wallet.signAuthorization({
        account: refunder,
        contractAddress: simple7702AccountAddress,
        executor: "self",
      });
      const hash = await wallet.sendTransaction({ authorizationList: [authorization], to: refunder.address });
      await wallet.waitForTransactionReceipt({ hash });
    }),
    async process(job, span) {
      const webhookId = parse(string(), job.id);
      span.setAttribute("panda.event", webhookId);
      const { account, amount, signature, timestamp } = parse(
        object({ account: Address, amount: number(), signature: Hex, timestamp: number() }),
        job.data,
      );
      const { requestBody } = await panda.getWebhook(webhookId);
      if (requestBody.resource !== "transaction") throw new Error("unexpected resource");
      if (requestBody.action !== "completed" && requestBody.action !== "updated") throw new Error("unexpected action");
      const { spend } = requestBody.body;
      const cents =
        spend.status === "reversed"
          ? -spend.authorizationUpdateAmount
          : spend.amount < 0
            ? -spend.amount
            : spend.authorizedAmount
              ? spend.authorizedAmount - spend.amount
              : undefined;
      if (cents === undefined || cents <= 0) throw new Error("refund amount not found");
      if (cents * 10_000 !== amount) throw new UnrecoverableError("amount mismatch");
      span.setAttribute("refund.amount", amount);
      const card = await database.query.cards.findFirst({
        columns: { mode: true },
        where: eq(cards.id, spend.cardId),
        with: { credential: { columns: { account: true, id: true, source: true } } },
      });
      if (!card) throw new Error("card not found");
      setUser({ id: card.credential.account });
      const user = await panda.getUser(spend.userId);
      if (!user.isActive) throw new Error("user is not active");
      const { parameters } = await panda.getWithdrawal(
        cents,
        parse(Address, refunderContract),
        parse(Address, refunder.address),
      );
      const receipt = await wallet
        .exaSend(
          { name: "panda.refund", op: "panda.refund", attributes: { account } },
          {
            address: refunder.address,
            functionName: "executeBatch",
            abi: [
              ...abi,
              ...parseAbi([
                "function executeBatch((address target, uint256 value, bytes data)[] calls)",
                "error ExecuteError(uint256 index, bytes revertData)",
              ]),
            ],
            args: [
              [
                {
                  data: encodeFunctionData({
                    abi: parseAbi([
                      "function withdrawAsset(address collateralProxy, address asset, uint256 amount, address recipient, uint256 expiresAt, bytes32 salt, bytes signature)",
                    ]),
                    args: [
                      parameters[0],
                      parameters[1],
                      BigInt(parameters[2]),
                      parameters[3],
                      BigInt(parameters[4]),
                      toHex(Buffer.from(parameters[5])),
                      parameters[6],
                    ],
                    functionName: "withdrawAsset",
                  }),
                  target: parse(
                    Address,
                    {
                      [baseSepolia.id]: "0x54d02DcB38B76A67dC9368D8457D1F384B865c70",
                      [optimismSepolia.id]: "0x4A6321D536a510cfE95A919DE869C4179bFb4856",
                      [base.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
                      [optimism.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
                    }[chain.id],
                  ),
                  value: 0n,
                },
                {
                  data: encodeFunctionData({
                    abi: refunderAbi,
                    args: [account, BigInt(amount), BigInt(timestamp), signature],
                    functionName: "refund",
                  }),
                  target: parse(Address, refunderContract),
                  value: 0n,
                },
              ],
            ],
          },
          {
            ignore: (reason) => reason.includes(toFunctionSelector("Replay()")),
            level: false,
            async onHash(hash) {
              const tx = await database.query.transactions.findFirst({
                where: and(eq(transactions.id, requestBody.body.id), eq(transactions.cardId, spend.cardId)),
              });
              const createdAt =
                requestBody.action === "completed"
                  ? requestBody.body.spend.postedAt
                  : requestBody.body.spend.authorizedAt;
              await (tx
                ? database
                    .update(transactions)
                    .set({
                      hashes: [...tx.hashes, hash],
                      payload: {
                        ...(tx.payload as object),
                        bodies: [...parse(TransactionPayload, tx.payload).bodies, { ...requestBody, createdAt }],
                      },
                    })
                    .where(and(eq(transactions.id, requestBody.body.id), eq(transactions.cardId, spend.cardId)))
                : database.insert(transactions).values([
                    {
                      id: requestBody.body.id,
                      cardId: spend.cardId,
                      hashes: [hash],
                      payload: { bodies: [{ ...requestBody, createdAt }], type: "panda" },
                    },
                  ]));
            },
            onReceipt: ({ blockNumber, status, transactionHash }) =>
              status === "reverted"
                ? undefined
                : hook
                    .enqueue({ receipt: { blockNumber: Number(blockNumber), transactionHash } }, webhookId)
                    .catch((error: unknown) =>
                      captureException(error, {
                        level: "error",
                        tags: { queue: hookName, job: hookName },
                        extra: { id: webhookId },
                      }),
                    ),
          },
        )
        .catch((error: unknown) => {
          const cause =
            error instanceof BaseError ? error.walk((r) => r instanceof ContractFunctionRevertedError) : undefined;
          if (!(cause instanceof ContractFunctionRevertedError) || cause.data?.errorName !== "ExecuteError")
            throw error;
          const [index, revertData] = cause.data.args as [bigint, Hex];
          const functionName = index === 0n ? "withdrawAsset" : "refund";
          const revert = new ContractFunctionExecutionError(
            new ContractFunctionRevertedError({ abi, data: revertData, functionName }),
            { abi, args: [], functionName },
          );
          if (!["Expired", "Unauthorized"].includes(revertReason(revert))) throw revert;
          throw Object.assign(new UnrecoverableError(revertReason(revert)), { cause: revert });
        });
      if (!receipt) return;
      const refundAmountUsd = cents / 100;
      onesignal
        .sendPushNotification({
          userId: account,
          headings: t("Refund processed"),
          contents: t("{{refundAmount}} USDC from {{merchantName}} have been refunded to your account", {
            refundAmount: f(refundAmountUsd),
            merchantName: spend.merchantName.trim(),
          }),
        })
        .catch((error: unknown) => captureException(error));
      segment.track({
        userId: account,
        event: "TransactionRefund",
        properties: {
          id: requestBody.body.id,
          type: spend.status === "reversed" ? "reversal" : spend.amount < 0 ? "refund" : "partial",
          source: card.credential.source,
          usdAmount: refundAmountUsd,
          merchant: {
            name: spend.merchantName,
            category: spend.merchantCategory,
            city: spend.merchantCity,
            country: spend.merchantCountry,
          },
        },
      });
      if (requestBody.action === "completed") {
        if (spend.amount < 0) {
          sardine
            .feedback({
              kind: "issuing",
              customer: { id: card.credential.id },
              transaction: { id: requestBody.body.id },
              feedback: { type: "settlement", status: "refund" },
            })
            .catch((error: unknown) => captureException(error, { level: "error" }));
        } else {
          sardine
            .feedback({
              kind: "issuing",
              customer: { id: card.credential.id },
              transaction: { id: requestBody.body.id, amount: spend.amount / 100 },
              feedback: { type: "settlement", status: "settled" },
            })
            .catch((error: unknown) => captureException(error, { level: "error" }));
        }
      }
    },
  });
}
