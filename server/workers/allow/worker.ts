import { captureException, withScope } from "@sentry/node";
import { and, eq, isNotNull, notExists } from "drizzle-orm";
import { parse, safeParse } from "valibot";
import {
  BaseError,
  bytesToHex,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  InternalRpcError,
  keccak256,
  toHex,
  zeroAddress,
} from "viem";

import chain, { auditorAbi, auditors, firewallAbi } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import createAllow from "./queue";
import { credentials, organizations } from "../../database/schema";
import { own } from "../../supervise";
import { NETWORKS } from "../../utils/alchemy";
import wallet from "../../utils/wallet";
import createPoke from "../poke/queue";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";
import type { LocalAccount } from "viem";

export default function worker({
  allower,
  bullmq,
  database,
}: {
  allower: LocalAccount;
  bullmq: Redis;
  database: NodePgDatabase<typeof schema>;
}) {
  const allow = createAllow(bullmq);
  const poke = createPoke(bullmq);
  return own(
    createWorker<Job>({
      attempts,
      bullmq,
      failed(job, error) {
        withScope((scope) => {
          if (job) scope.setUser({ id: job.data.account });
          captureException(error, {
            extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
            level: "error",
            tags: { queue: name, job: job?.name, chainId: job?.data.chainId },
          });
        });
      },
      name,
      ready: database
        .select({
          account: credentials.account,
          factory: credentials.factory,
          publicKey: credentials.publicKey,
          source: credentials.source,
        })
        .from(credentials)
        .where(
          and(
            isNotNull(credentials.pandaId),
            notExists(
              database
                .select({ id: organizations.id })
                .from(organizations)
                .where(eq(organizations.id, credentials.source)),
            ),
          ),
        )
        .then(async (rows) => {
          const candidates = rows.flatMap((credential) => {
            const account = safeParse(Address, credential.account);
            return account.success ? [{ ...credential, account: account.output }] : [];
          });
          const chains = [...auditors.keys()];
          const results = await Promise.allSettled(
            chains.map(async (chainId) => {
              const client = wallet(allower, network(chainId));
              const address = await firewall(client, chainId);
              if (!address) return;
              const [role, balance] = await Promise.all([
                client.readContract({
                  address,
                  functionName: "hasRole",
                  args: [keccak256(toHex("ALLOWER_ROLE")), allower.address],
                  abi: firewallAbi,
                }),
                client.getBalance({ address: allower.address }),
              ]);
              if (!role || balance === 0n) {
                captureException(new Error("allower not ready"), {
                  level: "warning",
                  tags: { queue: name, chainId },
                  extra: { role, balance },
                });
                return;
              }
              const allowed = await client.multicall({
                contracts: candidates.map(({ account }) => ({
                  address,
                  functionName: "isAllowed" as const,
                  args: [account],
                  abi: firewallAbi,
                })),
                batchSize: 65_536,
                deployless: true,
              });
              await allow.backfill(
                candidates
                  .filter((_, index) => allowed[index]?.result !== true)
                  .map((credential) => ({
                    account: credential.account,
                    chainId,
                    factory: parse(Address, credential.factory),
                    publicKey: bytesToHex(credential.publicKey),
                    source: credential.source,
                  })),
                chainId === chain.id ? 1 : 2,
              );
            }),
          );
          for (const [index, result] of results.entries()) {
            if (result.status === "rejected") {
              captureException(result.reason, { level: "error", tags: { queue: name, chainId: chains[index] } });
            }
          }
        })
        .catch((error: unknown) => {
          captureException(error, { level: "error", tags: { queue: name } });
        }),
      async process(job) {
        const client = wallet(allower, network(job.data.chainId));
        const address = await firewall(client, job.data.chainId);
        if (!address) return;
        await client.exaSend(
          {
            name: "firewall.allow",
            op: "exa.firewall",
            attributes: { account: job.data.account, chainId: job.data.chainId },
          },
          {
            address,
            functionName: "allow",
            args: [job.data.account, true],
            abi: firewallAbi,
          },
          {
            ignore: [`AlreadyAllowed(${job.data.account})`],
            ...(job.data.chainId !== chain.id && { fees: "auto" as const }),
          },
        );
        if (job.data.chainId !== chain.id) return;
        await poke.enqueue({
          account: job.data.account,
          assets: job.data.assets,
          chainId: job.data.chainId,
          factory: job.data.factory,
          origin: "allow",
          publicKey: job.data.publicKey,
          source: job.data.source,
        });
      },
    }),
    () => allow.close(),
    () => poke.close(),
  );
}

function firewall(client: ReturnType<typeof wallet>, chainId: number) {
  return client
    .readContract({ address: parse(Address, auditors.get(chainId)), functionName: "firewall", abi: auditorAbi })
    .then((address) => (address === zeroAddress ? undefined : address))
    .catch((error: unknown) => {
      if (!(error instanceof BaseError) || error.walk((cause) => cause instanceof InternalRpcError)) throw error;
      const revert = error.walk(
        (cause) => cause instanceof ContractFunctionRevertedError || cause instanceof ExecutionRevertedError,
      );
      if (!revert || (revert instanceof ContractFunctionRevertedError && (revert.raw ?? "0x") !== "0x")) throw error;
    });
}

function network(id: number) {
  const found = [...NETWORKS.values()].find((current) => current.id === id);
  if (!found) throw new Error(`unsupported chain ${id}`);
  return found;
}
