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
  const lock = await manteca.getPaymentLock(code);
  if (!lock) {
    return (
      (await manteca.getSynthetic(userOpHash)) ??
      (lock === null
        ? fail(ErrorCodes.EXPIRED_LOCK, { cause: "expired" })
        : fail(ErrorCodes.INVALID_PAYMENT, { cause: "lock" }))
    );
  }
  const personaAccount = await persona.getAccount(credentialId, "basic");
  const document = personaAccount && nationalId(personaAccount);
  if (!document || !lock.sender || legalId(document.id_number.value) !== legalId(lock.sender.legalId)) {
    return fail(ErrorCodes.INVALID_PAYMENT, { cause: "payer", persona: personaAccount?.id });
  }
  const receiver = await manteca.getSettlement(lock.paymentAsset);
  const assets = withdraws
    .filter(({ args }) => isAddressEqual(args.receiver, receiver))
    .reduce((total, { args }) => total + args.assets, 0n);
  if (assets * 100n < parseUnits(lock.paymentAgainstAmount, 8)) {
    return fail(ErrorCodes.INVALID_PAYMENT, {
      cause: "amount",
      assets: String(assets),
      lock: lock.paymentAgainstAmount,
    });
  }
  return await manteca.executeQrPayment(code, userOpHash);

  function fail(reason: string, details: Record<string, unknown>) {
    if (paid > 0n) {
      captureException(new Error("qr payment not executed"), {
        level: "error",
        contexts: { payment: { ...contexts.payment, ...details } },
      });
    }
    return { code: reason };
  }
}

function legalId(value: string) {
  return value.toLowerCase().replaceAll(/[.-]/g, "");
}
