import { captureEvent, captureException, setUser, withScope } from "@sentry/node";
import { UnrecoverableError } from "bullmq";
import * as v from "valibot";
import { parseUnits } from "viem";

import { Address, Hash } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import { ErrorCodes, findOperation, QRRecord } from "../../utils/ramps/manteca";
import createWorker from "../worker";

import type createManteca from "../../utils/ramps/manteca";
import type { Redis } from "ioredis";

export default function worker({
  bullmq,
  manteca,
  redis,
}: {
  bullmq: Redis;
  manteca: ReturnType<typeof createManteca>;
  redis: Redis;
}) {
  return createWorker<Job>({
    attempts,
    bullmq,
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          level: "error",
          contexts: { refund: { account: job?.data.account, userOpHash: job?.id, attempts: job?.attemptsMade } },
          tags: { queue: name },
        });
      });
    },
    name,
    async process(job) {
      const data = v.safeParse(Check, { ...job.data, userOpHash: job.id });
      if (!data.success) {
        throw Object.assign(new UnrecoverableError("invalid job data"), { cause: new v.ValiError(data.issues) });
      }
      const { account, code, timestamp, userOpHash, withdraws } = data.output;
      setUser({ id: account });
      if (settled(await manteca.getSynthetic(userOpHash))) return;
      const lock = await manteca.getPaymentLock(code);
      if (lock) throw new Error("qr lock valid");
      if (settled(await manteca.getSynthetic(userOpHash))) return;
      const operation = await findOperation(userOpHash);
      if (!operation?.success) {
        captureException(new Error("qr refund operation not found"), {
          level: "warning",
          contexts: { refund: { account, userOpHash } },
        });
        return;
      }
      const settlements = await manteca.getSettlements();
      const amount = withdraws
        .filter(({ receiver }) => receiver === settlements.ARS)
        .reduce((total, { assets }) => total + assets, 0n);
      const unsupported = withdraws
        .filter(({ receiver }) => receiver !== settlements.ARS && Object.values(settlements).includes(receiver))
        .reduce((total, { assets }) => total + assets, 0n);
      if (amount > 0n) {
        const record = v.safeParse(QRRecord, await redis.get(`qr:${code}`));
        if (!record.success) {
          captureException(new Error("qr refund unknown lock"), {
            level: "error",
            contexts: { refund: { account, userOpHash, amount: String(amount) } },
          });
          return;
        }
        const gas =
          record.output.account === account &&
          record.output.asset === "ARS" &&
          amount * 100n >= parseUnits(record.output.amount, 8) &&
          timestamp * 1000 <= Date.parse(record.output.expireAt) &&
          (await redis.get(`qr:${code}:op`)) === userOpHash
            ? "exa"
            : "user";
        const withdraw = await manteca.refundQRPayment(userOpHash, account, amount, gas);
        if (withdraw) {
          captureEvent({
            message: "QRPaymentRefund",
            level: "warning",
            contexts: {
              refund: {
                account,
                userOpHash,
                amount: String(amount),
                gas,
                reason: lock === null ? ErrorCodes.EXPIRED_LOCK : "lock not found",
                withdraw: withdraw.id,
              },
            },
          });
        }
      }
      if (unsupported > 0n) {
        captureException(new Error("qr refund unsupported entity"), {
          level: "error",
          contexts: { refund: { account, userOpHash, amount: String(unsupported) } },
        });
      }

      function settled(synthetic: Awaited<ReturnType<typeof manteca.getSynthetic>>) {
        if (!synthetic) return false;
        if (synthetic.status === "CANCELLED") {
          captureException(new Error("qr synthetic cancelled"), {
            level: "error",
            contexts: { refund: { account, userOpHash, synthetic: synthetic.id } },
          });
          return true;
        }
        if (synthetic.status === "COMPLETED") return true;
        throw new Error("qr synthetic pending");
      }
    },
  });
}

const Check = v.object({
  account: Address,
  code: v.string(),
  timestamp: v.number(),
  userOpHash: Hash,
  withdraws: v.array(
    v.object({
      assets: v.pipe(v.string(), v.digits(), v.toBigint()),
      receiver: Address,
    }),
  ),
});
