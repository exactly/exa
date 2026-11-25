import { captureException, setUser, withScope } from "@sentry/node";
import { UnrecoverableError } from "bullmq";
import * as v from "valibot";

import { attempts, Check, name, type Job } from "./job";
import { findOperation, refundQRPayment } from "../../utils/ramps/manteca";
import createWorker from "../worker";

import type createManteca from "../../utils/ramps/manteca";
import type { Redis } from "ioredis";
import type { LocalAccount } from "viem";

export default function worker({
  bullmq,
  issuer,
  manteca,
  redis,
  refunder,
}: {
  bullmq: Redis;
  issuer: LocalAccount;
  manteca: ReturnType<typeof createManteca>;
  redis: Redis;
  refunder: LocalAccount;
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
      const { account, code, userOpHash } = data.output;
      setUser({ id: account });
      const synthetic = await manteca.getSynthetic(userOpHash);
      if (synthetic?.status !== "CANCELLED") {
        if (settled(synthetic)) return;
        if (await manteca.getPaymentLock(code)) throw new Error("qr lock valid");
        if (settled(await manteca.getSynthetic(userOpHash))) return;
      }
      const operation = await findOperation(userOpHash);
      if (!operation) {
        const error = new Error("qr refund operation not found");
        if (job.attemptsMade === 0) {
          captureException(error, { level: "warning", contexts: { refund: { account, userOpHash } } });
        }
        throw error;
      }
      if (!operation.success) {
        captureException(new Error("qr refund operation reverted"), {
          level: "warning",
          contexts: { refund: { account, userOpHash } },
        });
        return;
      }
      await refundQRPayment(
        { issuer, redis, refunder },
        { ...data.output, settlements: await manteca.getSettlements() },
        true,
      );
    },
  });
}

function settled(synthetic: null | { status: string }) {
  if (!synthetic || synthetic.status === "CANCELLED") return false;
  if (synthetic.status === "COMPLETED") return true;
  throw new Error("qr synthetic pending");
}
