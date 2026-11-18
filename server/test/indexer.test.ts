import { and, asc, desc, eq, inArray } from "drizzle-orm";
import assert from "node:assert";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  hexToBigInt,
  http,
  keccak256,
  padHex,
  parseEventLogs,
  toHex,
  zeroAddress,
  zeroHash,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
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
  mockSwapperAbi,
  proposalManagerAbi,
  swapperAddress,
  upgradeableModularAccountAbi,
  usdcAddress,
  wethAddress,
} from "@exactly/common/generated/chain";

import { chains } from "./anvil";
import anvilClient from "./anvilClient";
import database from "../database";
import {
  accounts,
  bridges,
  collectors,
  delays,
  deposits,
  exaPlugins,
  liquidations,
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
  it("prices native bridges with the weth market", async () => {
    const owner = createWalletClient({
      chain: anvil,
      transport: http(),
      account: privateKeyToAccount(generatePrivateKey()),
    });
    const sender = deriveAddress(exaAccountFactoryAddress, { x: padHex(owner.account.address), y: zeroHash });
    await anvilClient.setBalance({ address: owner.account.address, value: 10n ** 24n });
    await anvilClient.waitForTransactionReceipt({
      hash: await owner.writeContract({
        address: exaAccountFactoryAddress,
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owner.account.address), y: 0n }]],
      }),
    });
    await anvilClient.setBalance({ address: sender, value: 10n ** 18n });
    const receipt = await anvilClient.waitForTransactionReceipt({
      hash: await owner.writeContract({
        address: sender,
        abi: upgradeableModularAccountAbi,
        functionName: "execute",
        args: [
          swapperAddress,
          10n ** 17n,
          encodeFunctionData({
            abi: mockSwapperAbi,
            functionName: "startBridgeTokensViaMock",
            args: [
              {
                transactionId: keccak256(toHex("native")),
                bridge: "mock",
                integrator: "exa_app",
                referrer: zeroAddress,
                sendingAssetId: zeroAddress,
                receiver: sender,
                minAmount: 10n ** 17n,
                destinationChainId: 1281n,
                hasSourceSwaps: false,
                hasDestinationCall: false,
              },
            ],
          }),
        ],
      }),
    });

    await vi.waitFor(
      async () =>
        expect(
          database
            .select({ asset: bridges.asset, amount: bridges.amount, usdPrice: bridges.usdPrice })
            .from(bridges)
            .where(and(eq(bridges.chainId, anvil.id), eq(bridges.account, sender.toLowerCase() as Hex))),
        ).resolves.toStrictEqual([
          {
            asset: zeroAddress,
            amount: 10n ** 17n,
            usdPrice: await assetPrice(wethAddress, receipt.blockNumber),
          },
        ]),
      { timeout: 10_000 },
    );
    expect(await assetPrice(wethAddress, receipt.blockNumber)).toBeGreaterThan(0n);
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

  it("indexes liquidations of exa accounts", async () => {
    const liquidated = deriveAddress(exaAccountFactoryAddress, {
      x: padHex(privateKeyToAddress(padHex("0x11a"))),
      y: zeroHash,
    });
    const logs = await anvilClient.getContractEvents({
      abi: marketAbi,
      eventName: "Liquidate",
      args: { borrower: liquidated },
      fromBlock: 0n,
      strict: true,
    });
    assert.ok(logs[0], "expected a Liquidate event");
    const { timestamp } = await anvilClient.getBlock({ blockNumber: logs[0].blockNumber });

    await expect(
      database
        .select()
        .from(liquidations)
        .where(and(eq(liquidations.chainId, anvil.id), eq(liquidations.account, liquidated.toLowerCase() as Hex)))
        .orderBy(asc(liquidations.logIndex)),
    ).resolves.toStrictEqual(
      logs.map(({ address, args, blockNumber, logIndex, transactionHash, transactionIndex }) => ({
        id: expect.any(String), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        chainId: anvil.id,
        hash: transactionHash,
        block: blockNumber,
        timestamp,
        transactionIndex,
        logIndex,
        account: liquidated.toLowerCase(),
        liquidator: args.receiver.toLowerCase(),
        market: address.toLowerCase(),
        assets: args.assets,
        lendersAssets: args.lendersAssets,
        seizeMarket: args.seizeMarket.toLowerCase(),
        seizedAssets: args.seizedAssets,
        usdPrice: expect.any(BigInt), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        seizeUsdPrice: 2n * 10n ** 18n,
      })),
    );
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
