import { isHash } from "viem";
import { getUserOperationReceipt, UserOperationReceiptNotFoundError } from "viem/account-abstraction";

import publicClient from "./publicClient";

export default async function findAccount(externalId: string | undefined) {
  if (!externalId || !isHash(externalId)) return;
  const receipt = await getUserOperationReceipt(publicClient, { hash: externalId }).catch((error: unknown) => {
    if (error instanceof UserOperationReceiptNotFoundError) return;
    throw error;
  });
  return receipt?.sender;
}
