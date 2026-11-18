import { captureException } from "@sentry/core";
import { isAddressEqual, parseEventLogs, parseUnits, type Log } from "viem";

import { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import * as nonceKey from "@exactly/common/nonceKey";

import { ErrorCodes, nationalId } from "./manteca";

import type createManteca from "./manteca";
import type createPersona from "../persona";
import type { Address, Hash } from "@exactly/common/validation";

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
    refund,
  }: { logs: Log[]; nonce: bigint; refund: boolean; sender: Address; success: boolean; userOpHash: Hash },
) {
  if (!success) return { code: ErrorCodes.INVALID_PAYMENT };
  const withdraws = withdrawn(Object.values(await manteca.getSettlements()), sender, logs);
  const paid = withdraws.reduce((total, { args }) => total + args.assets, 0n);
  const contexts = { payment: { account: sender, userOpHash, amount: String(paid) } };
  const code = nonceKey.decode(nonce);
  if (!code) {
    if (paid > 0n) captureException(new Error("usdc sent to settlement without qr lock"), { level: "error", contexts });
    return { code: ErrorCodes.INVALID_PAYMENT };
  }
  const lock = await manteca.getPaymentLock(code);
  if (!lock) {
    return (
      (await manteca.getSynthetic(userOpHash)) ??
      fail(lock === null ? ErrorCodes.EXPIRED_LOCK : ErrorCodes.INVALID_PAYMENT)
    );
  }
  const personaAccount = await persona.getAccount(credentialId, "basic");
  if (!personaAccount || !lock.sender || nationalId(personaAccount)?.id_number.value !== lock.sender.legalId) {
    return fail(ErrorCodes.INVALID_PAYMENT);
  }
  const receiver = await manteca.getSettlement(lock.paymentAsset);
  const assets = withdraws
    .filter(({ args }) => isAddressEqual(args.receiver, receiver))
    .reduce((total, { args }) => total + args.assets, 0n);
  if (assets * 100n < parseUnits(lock.paymentAgainstAmount, 8)) return fail(ErrorCodes.INVALID_PAYMENT);
  return await manteca.executeQrPayment(code, userOpHash);

  function fail(reason: string) {
    if (paid > 0n) {
      captureException(
        new Error("qr payment not executed"),
        refund
          ? { level: "info", contexts: { payment: { ...contexts.payment, refund: "automatic" } } }
          : { level: "error", contexts },
      );
    }
    return { code: reason };
  }
}

export function withdrawn(settlements: Address[], sender: Address, logs: Log[]) {
  return parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs }).filter(
    ({ address, args }) =>
      isAddressEqual(address, marketUSDCAddress) &&
      isAddressEqual(args.owner, sender) &&
      settlements.some((settlement) => isAddressEqual(settlement, args.receiver)),
  );
}
