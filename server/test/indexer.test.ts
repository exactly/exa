import { and, desc, eq } from "drizzle-orm";
import assert from "node:assert";
import { createPublicClient, http, padHex, zeroHash, type Hex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { anvil } from "viem/chains";
import { describe, expect, it } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import {
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPluginAddress,
  proposalManagerAbi,
} from "@exactly/common/generated/chain";

import { chains } from "./anvil";
import anvilClient from "./anvilClient";
import database from "../database";
import { accounts, collectors, delays, plugins } from "../database/indexer";

const account = deriveAddress(exaAccountFactoryAddress, {
  x: padHex(privateKeyToAddress(padHex("0xb0b"))),
  y: zeroHash,
});

describe("indexer", () => {
  it("indexes accounts and their exa plugins", async () => {
    const [initialized] = await anvilClient.getContractEvents({
      address: exaAccountFactoryAddress,
      abi: exaAccountFactoryAbi,
      eventName: "ExaAccountInitialized",
      args: { account },
      fromBlock: 0n,
      strict: true,
    });
    assert.ok(initialized, "expected an ExaAccountInitialized event");
    const [{ timestamp }, owner] = await Promise.all([
      anvilClient.getBlock({ blockNumber: initialized.blockNumber }),
      anvilClient.readContract({
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "WEBAUTHN_OWNER_PLUGIN",
      }),
    ]);

    await expect(
      database
        .select()
        .from(accounts)
        .where(and(eq(accounts.chainId, anvil.id), eq(accounts.address, account.toLowerCase() as Hex))),
    ).resolves.toStrictEqual([
      {
        chainId: anvil.id,
        address: account.toLowerCase(),
        factory: exaAccountFactoryAddress.toLowerCase(),
        owner: owner.toLowerCase(),
        block: initialized.blockNumber,
        timestamp,
      },
    ]);
    await expect(
      database
        .select()
        .from(plugins)
        .where(and(eq(plugins.chainId, anvil.id), eq(plugins.account, account.toLowerCase() as Hex))),
    ).resolves.toStrictEqual([
      {
        chainId: anvil.id,
        account: account.toLowerCase(),
        address: exaPluginAddress.toLowerCase(),
        block: initialized.blockNumber,
        timestamp,
      },
    ]);
  });

  it.each(chains)("indexes the collector and the proposal manager delay on $name", async (chain) => {
    const client = createPublicClient({ chain, transport: http() });
    const [collector, proposalManager] = await Promise.all([
      client.readContract({ address: exaPluginAddress, abi: exaPluginAbi, functionName: "collector" }),
      client.readContract({ address: exaPluginAddress, abi: exaPluginAbi, functionName: "proposalManager" }),
    ]);
    const delay = await client.readContract({
      address: proposalManager,
      abi: proposalManagerAbi,
      functionName: "delay",
    });

    await expect(
      database
        .select({ address: collectors.address })
        .from(collectors)
        .where(and(eq(collectors.chainId, chain.id), eq(collectors.plugin, exaPluginAddress.toLowerCase() as Hex)))
        .orderBy(desc(collectors.block), desc(collectors.logIndex))
        .limit(1),
    ).resolves.toStrictEqual([{ address: collector.toLowerCase() }]);
    await expect(
      database
        .select({ delay: delays.delay })
        .from(delays)
        .where(and(eq(delays.chainId, chain.id), eq(delays.proposalManager, proposalManager.toLowerCase() as Hex))),
    ).resolves.toStrictEqual([{ delay }]);
  });
});
