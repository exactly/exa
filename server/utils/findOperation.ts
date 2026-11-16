import { isHash } from "viem";
import { getUserOperationReceipt, UserOperationReceiptNotFoundError } from "viem/account-abstraction";

import publicClient from "./publicClient";

export default async function findOperation(hash: string | undefined) {
  if (!hash || !isHash(hash)) return;
  return await getUserOperationReceipt(publicClient, { hash }).catch((error: unknown) => {
    if (error instanceof UserOperationReceiptNotFoundError) return;
    throw error;
  });
}
