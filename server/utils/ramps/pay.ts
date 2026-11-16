import { captureException } from "@sentry/core";
import { isAddressEqual, parseEventLogs, parseUnits, type Log } from "viem";

import { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import * as nonceKey from "@exactly/common/nonceKey";

import { ErrorCodes, nationalId } from "./manteca";

import type createManteca from "./manteca";
import type { SyntheticResponse } from "./manteca";
import type createPersona from "../persona";
import type { Address, Hash } from "@exactly/common/validation";
import type { InferOutput } from "valibot";

export default async function pay(
  manteca: ReturnType<typeof createManteca>,
  persona: Pick<ReturnType<typeof createPersona>, "getAccount">,
  credentialId: string,
  {
    userOpHash,
    sender,
    nonce,
    success,
    logs,
  }: { logs: Log[]; nonce: bigint; sender: Address; success: boolean; userOpHash: Hash },
) {
  if (!success) return { code: ErrorCodes.INVALID_PAYMENT };
  const settlements = Object.values(await manteca.getSettlements());
  const withdraws = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs }).filter(
    ({ address, args }) =>
      isAddressEqual(address, marketUSDCAddress) &&
      isAddressEqual(args.owner, sender) &&
      settlements.some((settlement) => isAddressEqual(settlement, args.receiver)),
  );
  const paid = withdraws.reduce((total, { args }) => total + args.assets, 0n);
  const contexts = { payment: { account: sender, userOpHash, amount: String(paid) } };
  const code = nonceKey.decode(nonce);
  if (!code) {
    if (paid > 0n) captureException(new Error("usdc sent to settlement without qr lock"), { level: "error", contexts });
    return { code: ErrorCodes.INVALID_PAYMENT };
  }
  let synthetic: InferOutput<typeof SyntheticResponse> | null | undefined;
  try {
    const lock = await manteca.getPaymentLock(code);
    if (!lock) {
      synthetic = await manteca.getSynthetic(userOpHash);
      return synthetic ?? { code: ErrorCodes.EXPIRED_LOCK };
    }
    const personaAccount = await persona.getAccount(credentialId, "basic");
    if (!personaAccount || !lock.sender || nationalId(personaAccount)?.id_number.value !== lock.sender.legalId) {
      return { code: ErrorCodes.INVALID_PAYMENT };
    }
    const receiver = await manteca.getSettlement(lock.paymentAsset);
    const assets = withdraws
      .filter(({ args }) => isAddressEqual(args.receiver, receiver))
      .reduce((total, { args }) => total + args.assets, 0n);
    if (assets * 100n < parseUnits(lock.paymentAgainstAmount, 8)) return { code: ErrorCodes.INVALID_PAYMENT };
    synthetic = await manteca.executeQrPayment(code, userOpHash);
    return synthetic;
  } finally {
    if (!synthetic && paid > 0n) {
      captureException(new Error("qr payment not executed"), { level: "error", contexts });
    }
  }
}
