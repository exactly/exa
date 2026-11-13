import { and, asc, desc, eq } from "drizzle-orm";
import assert from "node:assert";
import { createPublicClient, erc20Abi, hexToBigInt, http, padHex, parseEventLogs, zeroHash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { anvil } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import {
  auditorAbi,
  auditorAddress,
  exaAccountFactoryAbi,
  exaAccountFactoryAddress,
  exaPluginAbi,
  exaPluginAddress,
  factories,
  marketAbi,
  marketUSDCAddress,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";

import { chains } from "./anvil";
import anvilClient from "./anvilClient";
import database from "../database";
import { accounts, collectors, delays, deposits, exaPlugins, markets, plugins } from "../database/indexer";

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
    const [{ timestamp }, owner, installed] = await Promise.all([
      anvilClient.getBlock({ blockNumber: initialized.blockNumber }),
      anvilClient.readContract({
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "WEBAUTHN_OWNER_PLUGIN",
      }),
      anvilClient
        .getContractEvents({
          address: account,
          abi: upgradeableModularAccountAbi,
          eventName: "PluginInstalled",
          fromBlock: initialized.blockNumber,
          toBlock: initialized.blockNumber,
          strict: true,
        })
        .then((logs) => logs.find(({ args }) => args.plugin === exaPluginAddress)),
    ]);
    assert.ok(installed, "expected the exa plugin to be installed");

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
        plugin: exaPluginAddress.toLowerCase(),
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
        logIndex: installed.logIndex,
        uninstalled: null,
      },
    ]);
    await expect(
      database
        .select()
        .from(exaPlugins)
        .where(and(eq(exaPlugins.chainId, anvil.id), eq(exaPlugins.address, exaPluginAddress.toLowerCase() as Hex))),
    ).resolves.toStrictEqual([{ chainId: anvil.id, address: exaPluginAddress.toLowerCase() }]);
  });

  it("indexes accounts of legacy factories without initialization events", async () => {
    const [legacy] = factories.legacy;
    assert.ok(legacy, "expected a legacy factory");
    const owner = privateKeyToAddress(generatePrivateKey());
    const legacyAccount = deriveAddress(legacy, { x: padHex(owner), y: zeroHash });
    const created = await anvilClient.waitForTransactionReceipt({
      hash: await anvilClient.writeContract({
        address: legacy,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner), y: 0n }]],
        account: null,
      }),
    });
    expect(parseEventLogs({ abi: exaAccountFactoryAbi, logs: created.logs })).toStrictEqual([]);
    const [depositor] = await anvilClient.getAddresses();
    assert.ok(depositor, "expected an anvil account");
    await anvilClient.waitForTransactionReceipt({
      hash: await anvilClient.writeContract({
        address: usdcAddress,
        abi: [
          {
            type: "function",
            name: "mint",
            inputs: [{ type: "address" }, { type: "uint256" }],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        functionName: "mint",
        args: [depositor, 1_000_000n],
        account: depositor,
      }),
    });
    await anvilClient.waitForTransactionReceipt({
      hash: await anvilClient.writeContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [marketUSDCAddress, 1_000_000n],
        account: depositor,
      }),
    });
    await anvilClient.waitForTransactionReceipt({
      hash: await anvilClient.writeContract({
        address: marketUSDCAddress,
        abi: marketAbi,
        functionName: "deposit",
        args: [1_000_000n, legacyAccount],
        account: depositor,
      }),
    });
    const [{ timestamp }, ownerPlugin] = await Promise.all([
      anvilClient.getBlock({ blockNumber: created.blockNumber }),
      anvilClient.readContract({ address: legacy, abi: exaAccountFactoryAbi, functionName: "WEBAUTHN_OWNER_PLUGIN" }),
    ]);

    await vi.waitFor(
      async () => {
        await expect(
          database
            .select()
            .from(accounts)
            .where(and(eq(accounts.chainId, anvil.id), eq(accounts.address, legacyAccount.toLowerCase() as Hex))),
        ).resolves.toStrictEqual([
          {
            chainId: anvil.id,
            address: legacyAccount.toLowerCase(),
            factory: legacy.toLowerCase(),
            owner: ownerPlugin.toLowerCase(),
            plugin: exaPluginAddress.toLowerCase(),
            block: created.blockNumber,
            timestamp,
          },
        ]);
        await expect(
          database
            .select({ market: deposits.market, assets: deposits.assets })
            .from(deposits)
            .where(and(eq(deposits.chainId, anvil.id), eq(deposits.account, legacyAccount.toLowerCase() as Hex))),
        ).resolves.toStrictEqual([{ market: marketUSDCAddress.toLowerCase(), assets: 1_000_000n }]);
      },
      { timeout: 10_000 },
    );
  });

  it("trusts plugins allowed by an exa plugin", async () => {
    const allowed = padHex("0xa110", { size: 20 });
    await anvilClient.waitForTransactionReceipt({
      hash: await anvilClient.writeContract({
        address: exaPluginAddress,
        abi: exaPluginAbi,
        functionName: "allowPlugin",
        args: [allowed, true],
        account: null,
      }),
    });

    await vi.waitFor(
      () =>
        expect(
          database
            .select()
            .from(exaPlugins)
            .where(and(eq(exaPlugins.chainId, anvil.id), eq(exaPlugins.address, allowed))),
        ).resolves.toStrictEqual([{ chainId: anvil.id, address: allowed }]),
      { timeout: 10_000 },
    );
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
  it("indexes markets with their price feeds", async () => {
    const listed = await anvilClient.readContract({
      address: auditorAddress,
      abi: auditorAbi,
      functionName: "allMarkets",
    });
    const expected = await Promise.all(
      listed.map(async (market) => {
        const [asset, symbol, decimals, data] = await Promise.all([
          anvilClient.readContract({ address: market, abi: marketAbi, functionName: "asset" }),
          anvilClient.readContract({ address: market, abi: marketAbi, functionName: "symbol" }),
          anvilClient.readContract({ address: market, abi: marketAbi, functionName: "decimals" }),
          anvilClient.readContract({
            address: auditorAddress,
            abi: auditorAbi,
            functionName: "markets",
            args: [market],
          }),
        ]);
        return {
          chainId: anvil.id,
          address: market.toLowerCase(),
          asset: asset.toLowerCase(),
          symbol: symbol.slice(3),
          decimals,
          priceFeed: data[4].toLowerCase(),
        };
      }),
    );

    await expect(
      database.select().from(markets).where(eq(markets.chainId, anvil.id)).orderBy(asc(markets.address)),
    ).resolves.toStrictEqual(expected.toSorted((a, b) => a.address.localeCompare(b.address)));
  });
});
