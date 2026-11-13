import { and, asc, desc, eq, inArray } from "drizzle-orm";
import assert from "node:assert";
import {
  createPublicClient,
  erc20Abi,
  http,
  keccak256,
  padHex,
  toHex,
  zeroHash,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAddress } from "viem/accounts";
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
  marketAbi,
  mockSwapperAbi,
  proposalManagerAbi,
  swapperAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";

import { chains } from "./anvil";
import anvilClient from "./anvilClient";
import database from "../database";
import {
  accounts,
  bridges,
  collectors,
  delays,
  exaPlugins,
  markets,
  plugins,
  swaps,
  tokens,
} from "../database/indexer";

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

  it("indexes exa app swaps received by exa accounts", async () => {
    const logs = await anvilClient.getContractEvents({
      address: swapperAddress,
      abi: mockSwapperAbi,
      eventName: "LiFiGenericSwapCompleted",
      fromBlock: 0n,
      strict: true,
    });
    const received = logs.filter(({ args }) => args.receiver === account);
    expect(received.length).toBeGreaterThanOrEqual(2);
    const blocks = await Promise.all(received.map(({ blockNumber }) => anvilClient.getBlock({ blockNumber })));
    const prices = await Promise.all(
      received.map(({ args, blockNumber }) =>
        Promise.all([assetPrice(args.fromAssetId, blockNumber), assetPrice(args.toAssetId, blockNumber)]),
      ),
    );
    expect(prices.flat()).not.toContain(null);

    await expect(
      database
        .select()
        .from(swaps)
        .where(and(eq(swaps.chainId, anvil.id), eq(swaps.account, account.toLowerCase() as Hex)))
        .orderBy(asc(swaps.block), asc(swaps.logIndex)),
    ).resolves.toStrictEqual(
      received.map(({ args, blockNumber, logIndex, transactionHash, transactionIndex }, index) => ({
        id: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        chainId: anvil.id,
        hash: transactionHash,
        block: blockNumber,
        timestamp: blocks[index]?.timestamp,
        transactionIndex,
        logIndex,
        account: account.toLowerCase(),
        transactionId: args.transactionId,
        fromAsset: args.fromAssetId.toLowerCase(),
        toAsset: args.toAssetId.toLowerCase(),
        fromAmount: args.fromAmount,
        toAmount: args.toAmount,
        fromUsdPrice: prices[index]?.[0],
        toUsdPrice: prices[index]?.[1],
      })),
    );
    const assets = [...new Set(received.flatMap(({ args }) => [args.fromAssetId, args.toAssetId]))];
    await expect(
      database
        .select({ address: tokens.address, symbol: tokens.symbol, decimals: tokens.decimals })
        .from(tokens)
        .where(
          and(
            eq(tokens.chainId, anvil.id),
            inArray(
              tokens.address,
              assets.map((address) => address.toLowerCase() as Hex),
            ),
          ),
        )
        .orderBy(asc(tokens.symbol)),
    ).resolves.toStrictEqual(
      await Promise.all(
        assets.map(async (address) => ({
          address: address.toLowerCase(),
          symbol: await anvilClient.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
          decimals: await anvilClient.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
        })),
      ).then((rows) => rows.toSorted((a, b) => a.symbol.localeCompare(b.symbol))),
    );
  });

  it("indexes exa app bridges sent by exa accounts", async () => {
    const [started] = await anvilClient.getContractEvents({
      address: swapperAddress,
      abi: mockSwapperAbi,
      eventName: "LiFiTransferStarted",
      fromBlock: 0n,
      strict: true,
    });
    assert.ok(started, "expected a LiFiTransferStarted event");
    const { timestamp } = await anvilClient.getBlock({ blockNumber: started.blockNumber });

    await expect(
      database
        .select()
        .from(bridges)
        .where(and(eq(bridges.chainId, anvil.id), eq(bridges.account, account.toLowerCase() as Hex))),
    ).resolves.toStrictEqual([
      {
        id: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        chainId: anvil.id,
        hash: started.transactionHash,
        block: started.blockNumber,
        timestamp,
        transactionIndex: started.transactionIndex,
        logIndex: started.logIndex,
        account: account.toLowerCase(),
        transactionId: keccak256(toHex("bob")),
        bridge: "mock",
        asset: started.args.bridgeData.sendingAssetId.toLowerCase(),
        amount: 30n * 10n ** 18n,
        receiver: privateKeyToAddress(padHex("0xb0b")).toLowerCase(),
        destinationChainId: 1281n,
        usdPrice: await assetPrice(started.args.bridgeData.sendingAssetId, started.blockNumber),
      },
    ]);
  });
  it("indexes exa app bridges received by exa accounts from other networks", async () => {
    const chain = chains[1];
    assert.ok(chain, "expected a second chain");
    const client = createPublicClient({ chain, transport: http() });
    const [started] = await client
      .getContractEvents({
        address: swapperAddress,
        abi: mockSwapperAbi,
        eventName: "LiFiTransferStarted",
        fromBlock: 0n,
        strict: true,
      })
      .then((logs) => logs.filter(({ args }) => args.bridgeData.receiver === account));
    assert.ok(started, "expected a LiFiTransferStarted event");
    const { timestamp } = await client.getBlock({ blockNumber: started.blockNumber });
    const asset = started.args.bridgeData.sendingAssetId;

    await expect(
      database
        .select()
        .from(bridges)
        .where(
          and(eq(bridges.destinationChainId, BigInt(anvil.id)), eq(bridges.receiver, account.toLowerCase() as Hex)),
        ),
    ).resolves.toStrictEqual([
      {
        id: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        chainId: chain.id,
        hash: started.transactionHash,
        block: started.blockNumber,
        timestamp,
        transactionIndex: started.transactionIndex,
        logIndex: started.logIndex,
        account: null,
        transactionId: keccak256(toHex("bob in")),
        bridge: "mock",
        asset: asset.toLowerCase(),
        amount: 25n * 10n ** 6n,
        receiver: account.toLowerCase(),
        destinationChainId: BigInt(anvil.id),
        usdPrice: await assetPrice(asset, started.blockNumber, client),
      },
    ]);
  });
});

async function assetPrice(asset: Hex, blockNumber: bigint, client: PublicClient = anvilClient) {
  const all = await client.readContract({ address: auditorAddress, abi: auditorAbi, functionName: "allMarkets" });
  const assets = await Promise.all(
    all.map((address) => client.readContract({ address, abi: marketAbi, functionName: "asset" })),
  );
  const market = all[assets.indexOf(asset)];
  if (!market) return null;
  const priceFeed = await client
    .readContract({ address: auditorAddress, abi: auditorAbi, functionName: "markets", args: [market] })
    .then((data) => data[4]);
  return client.readContract({
    address: auditorAddress,
    abi: auditorAbi,
    functionName: "assetPrice",
    args: [priceFeed],
    blockNumber,
  });
}
