import { getAbiItem, isHash } from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";

import { clients } from "./publicClient";

export default async function findAccount(externalId: string | undefined) {
  if (!externalId || !isHash(externalId)) return;
  const logs = await Promise.all(
    clients.values().map((client) =>
      client.getLogs({
        address: entryPoint06Address,
        event: getAbiItem({ abi: entryPoint06Abi, name: "UserOperationEvent" }),
        args: { userOpHash: externalId },
        fromBlock: "earliest",
        strict: true,
      }),
    ),
  );
  return logs.flat()[0]?.args.sender;
}
