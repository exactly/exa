import { captureException } from "@sentry/core";
import { isAddressEqual, parseEventLogs, parseUnits } from "viem";
import { getUserOperationReceipt, UserOperationReceiptNotFoundError } from "viem/account-abstraction";

import { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";
import * as nonceKey from "@exactly/common/nonceKey";

import { ErrorCodes, nationalId } from "./manteca";
import publicClient from "../publicClient";

import type createManteca from "./manteca";
import type { SyntheticResponse } from "./manteca";
import type createPersona from "../persona";
import type { Address, Hash } from "@exactly/common/validation";
import type { InferOutput } from "valibot";

export default async function pay(
  manteca: ReturnType<typeof createManteca>,
  persona: Pick<ReturnType<typeof createPersona>, "getAccount">,
  account: Address,
  credentialId: string,
  userOpHash: Hash,
) {
  const receipt = await getUserOperationReceipt(publicClient, { hash: userOpHash }).catch((error: unknown) => {
    if (error instanceof UserOperationReceiptNotFoundError) return;
    throw error;
  });
  if (!receipt) return { code: ErrorCodes.USER_OPERATION_NOT_FOUND };
  if (!receipt.success || !isAddressEqual(receipt.sender, account)) return { code: ErrorCodes.INVALID_PAYMENT };
  const settlements = Object.values(await manteca.getSettlements());
  const withdraws = parseEventLogs({ abi: marketAbi, eventName: "Withdraw", logs: receipt.logs }).filter(
    ({ address, args }) =>
      isAddressEqual(address, marketUSDCAddress) &&
      isAddressEqual(args.owner, account) &&
      settlements.some((settlement) => isAddressEqual(settlement, args.receiver)),
  );
  const paid = withdraws.reduce((total, { args }) => total + args.assets, 0n);
  let synthetic: InferOutput<typeof SyntheticResponse> | null | undefined;
  try {
    const code = nonceKey.decode(BigInt(receipt.nonce)); // eslint-disable-line @typescript-eslint/no-unnecessary-type-conversion -- viem keeps the rpc hex
    if (!code) return { code: ErrorCodes.INVALID_PAYMENT };
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
      captureException(new Error("qr payment not executed"), {
        level: "error",
        contexts: { payment: { account, userOpHash, amount: String(paid) } },
      });
    }
  }
}
