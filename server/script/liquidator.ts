import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { auditorAddress, previewerAddress, usdcAddress, wethAddress } from "@exactly/common/generated/chain";
import { mulDiv } from "@exactly/lib";
import createDebug from "debug";
import { execSync } from "node:child_process";
import { argv, env, exit } from "node:process";
import {
  BaseError,
  concat,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  http,
  maxUint256,
  nonceManager,
  numberToHex,
  padHex,
  sliceHex,
  toFunctionSelector,
  zeroAddress,
  type Address,
  type Log,
  type ReadContractReturnType,
  type StateOverride,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { optimism } from "viem/chains";

import {
  auditorAbi,
  auditorBlockNumber,
  liquidatorAbi,
  liquidatorAddress,
  marketAbi,
  previewerAbi,
} from "../generated/contracts";

const debug = Object.assign(createDebug("exa:liquidator"), { inspectOpts: { depth: undefined } });

async function liquidator(blockNumber?: bigint) {
  if (env.CHAIN_ID && Number(env.CHAIN_ID) !== chain.id) throw new Error("wrong chain");
  if (!liquidatorAddress) {
    if (env.NODE_ENV === "production") throw new Error("missing liquidator deployment");
    else debug("missing liquidator deployment");
  }

  // #region targets
  const targets: Address[] = [];
  {
    const toBlock = Number(blockNumber ?? (await bigClient.getBlockNumber()));
    const accounts = [
      ...new Set(
        await Promise.all(
          Array.from({ length: Math.ceil((toBlock - auditorBlockNumber) / LOG_BATCH_SIZE) }).map((_, index) =>
            bigClient.request({
              method: "eth_getLogs",
              params: [
                {
                  address: auditorAddress,
                  topics: [marketEnteredTopic],
                  fromBlock: numberToHex(auditorBlockNumber + index * LOG_BATCH_SIZE),
                  toBlock: numberToHex(Math.min(auditorBlockNumber + (index + 1) * LOG_BATCH_SIZE, toBlock)),
                },
              ],
            }),
          ),
        ).then((logs) => logs.flat().map(({ topics }) => sliceHex(topics[2]!, 12))), // eslint-disable-line @typescript-eslint/no-non-null-assertion -- event topics are guaranteed
      ),
    ];
    for (let index = 0; index < accounts.length; index += ACCOUNT_BATCH_SIZE) {
      await Promise.all(
        accounts.slice(index, index + ACCOUNT_BATCH_SIZE).map(async (acct) => {
          const callData = concat([accountLiquiditySelector, padHex(acct, { size: 32 }), ZERO64]);
          const { data = "0x" } = await bigClient.call({ to: auditorAddress, data: callData, blockNumber });
          const [collateral, debt] = decodeFunctionResult({ data, abi: [accountLiquidityAbiItem] });
          if (debt > collateral && debt > DUST_THRESHOLD && collateral > DUST_THRESHOLD) targets.push(getAddress(acct));
        }),
      );
    }
  }
  // #endregion

  const stateOverrides = liquidatorAddress
    ? undefined
    : ([
        {
          address: walletAccount.address,
          code: execSync(`forge script script/Liquidator.s.sol -s 'getCode()' --chain ${chain.id}`, {
            cwd: "../contracts",
            encoding: "utf8",
          }).replace(/.*code: bytes (0x\w+)\n/s, "$1") as `0x${string}`,
          stateDiff: [{ slot: OWNER_SLOT, value: padHex(walletAccount.address, { size: 32 }) }],
        },
      ] satisfies StateOverride);

  // #region liquidations
  /* eslint unicorn/prevent-abbreviations: ["error", { allowList: { Args: true } }] */
  const results = await Promise.allSettled(
    targets.map(async (account) => {
      const exactly = await smallClient.readContract({
        address: previewerAddress,
        functionName: "exactly",
        args: [account],
        abi: previewerAbi,
        blockNumber,
      });
      const [repay] = exactly
        .toSorted((a, b) => Number(toUSD(totalDebt(b), b) - toUSD(totalDebt(a), a)))
        .map((marketAccount) => ({ ...marketAccount, assetSymbol: marketAccount.symbol.slice(3) }));
      const [seize] = exactly
        .filter(({ isCollateral }) => isCollateral)
        .toSorted((a, b) => Number(toUSD(b.floatingDepositAssets, b) - toUSD(a.floatingDepositAssets, a)))
        .map((marketAccount) => ({ ...marketAccount, assetSymbol: marketAccount.symbol.slice(3) }));
      if (!repay || !seize) throw new Error("market not found");
      const {
        results: [, preflight],
      } = await smallClient.simulateCalls({
        account: repay.market,
        calls: [
          { to: repay.asset, functionName: "approve", args: [repay.market, maxUint256], abi: protocolAbi },
          { to: repay.market, functionName: "liquidate", args: [account, maxUint256, seize.market], abi: protocolAbi },
        ],
        blockNumber,
      });
      if (preflight.status !== "success") {
        if (["InsufficientShortfall", "ZeroWithdraw"].includes(errorName(preflight.error))) return;
        throw new Error(preflight.error.message);
      }
      const { assets: preflightAssets } = parseLiquidateEvent(preflight.logs);
      debug(account, Number(toUSD(preflightAssets, repay)) / 1e18, `${repay.assetSymbol}/${seize.assetSymbol}`);
      const maxRepay = mulDiv(preflightAssets, 1003n, 1000n) + 2n;
      const { uniswap: uniswapArgs, velodrome: velodromeArgs } = poolArgs(repay.assetSymbol, seize.assetSymbol);
      const uniswapCall = {
        to: liquidatorAddress ?? walletAccount.address,
        functionName: "liquidateUniswap",
        args: [repay.market, seize.market, account, maxRepay, ...uniswapArgs],
        abi: [...liquidatorAbi, ...protocolAbi],
      } as const;
      const velodromeCall = {
        to: uniswapCall.to,
        functionName: "liquidateVelodrome",
        args: [repay.market, seize.market, account, maxRepay, ...velodromeArgs],
        abi: [...liquidatorAbi, ...protocolAbi, { type: "error", name: "InsufficientLiquidity", inputs: [] }],
      } as const;
      const [{ results: uniswap }, { results: velodrome }] = await Promise.all([
        smallClient.simulateCalls({ account: walletAccount, calls: [uniswapCall], stateOverrides, blockNumber }),
        smallClient.simulateCalls({ account: walletAccount, calls: [velodromeCall], stateOverrides, blockNumber }),
      ]);
      const simulations = [uniswap[0], velodrome[0]];
      const errors = simulations.filter((s) => s.status === "failure").map((s) => s.error);
      const unexpectedErrors = errors.filter(
        (error) =>
          !["InsufficientShortfall", "ZeroWithdraw", "TransferFailed", "Unsupported"].includes(errorName(error)),
      );
      if (errors.length === simulations.length && unexpectedErrors.length === 0) return;
      const [simulation] = simulations
        .filter((s) => s.status === "success")
        .map((s) => ({
          call: s === velodrome[0] ? velodromeCall : uniswapCall,
          assets: parseLiquidateEvent(s.logs).assets,
          gasUsed: s.gasUsed,
        }))
        .sort(({ assets: a }, { assets: b }) => Number(b - a));
      if (!simulation) throw new Error(unexpectedErrors.map(({ message }) => message).join("\n"));
      if (simulation.assets < preflightAssets) debug(`${account} ${simulation.assets} < ${preflightAssets}`);
      if (blockNumber || stateOverrides) {
        debug(account, "simulation", Number(toUSD(simulation.assets, repay)) / 1e18);
        return;
      }
      const hash = await walletClient.sendTransaction({
        data: encodeFunctionData({ ...simulation.call, abi: liquidatorAbi }),
        address: simulation.call.to,
        type: "eip1559",
        maxFeePerGas: 10_000_000n,
        maxPriorityFeePerGas: 10_000n,
        gas: mulDiv(simulation.gasUsed, 15n, 10n),
      });
      debug(account, hash);
      await smallClient.waitForTransactionReceipt({ hash, confirmations: 0 });
    }),
  );
  for (const result of results) if (result.status !== "fulfilled") debug(result.reason);
  if (results.some(({ status }) => status !== "fulfilled")) throw new Error("some liquidations failed");
  // #endregion
}

// #region config
const POOLS = {
  [optimism.id]: {
    OP: { USDC: { uniswap: { fee: 3000 }, velodrome: { poolPair: wethAddress } } },
    USDC: { USDC: { fee: 100, poolPair: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" }, WBTC: { fee: 3000 } },
    WBTC: { wstETH: { fee: 100, pairFee: 500, poolPair: wethAddress } },
    WETH: { wstETH: { fee: 100 } },
  },
}[chain.id] as
  | Record<string, Record<string, UniswapArgs | { uniswap?: UniswapArgs; velodrome: VelodromeArgs }>>
  | undefined;
const DUST_THRESHOLD = 10_000_000_000_000_000n; // 0.01 adjusted USD
const LOG_BATCH_SIZE = 25_000_000;
const ACCOUNT_BATCH_SIZE = 5000;
// #endregion

// #region global
if (!chain.rpcUrls.alchemy?.http[0]) throw new Error("missing alchemy rpc url");
if (!process.env.LIQUIDATOR_MNEMONIC) throw new Error("missing liquidator mnemonic");
const transport = http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, { batch: true });
const walletAccount = mnemonicToAccount(process.env.LIQUIDATOR_MNEMONIC, { nonceManager });
const walletClient = createWalletClient({ account: walletAccount, chain, transport });
const smallClient = createPublicClient({ batch: { multicall: { batchSize: 1800 } }, chain, transport });
const bigClient = createPublicClient({ batch: { multicall: { batchSize: 500_000 } }, chain, transport });
const protocolAbi = [...auditorAbi, ...marketAbi, { type: "error", name: "TransferFailed", inputs: [] }] as const;
const accountLiquidityAbiItem = getAbiItem({ name: "accountLiquidity", abi: auditorAbi });
const accountLiquiditySelector = toFunctionSelector(accountLiquidityAbiItem);
const [marketEnteredTopic] = encodeEventTopics({ eventName: "MarketEntered", abi: auditorAbi });
const [liquidateTopic] = encodeEventTopics({ abi: marketAbi, eventName: "Liquidate" });
const OWNER_SLOT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffff74873927";
const ZERO64 = padHex("0x", { size: 64 });
// #endregion

liquidator(argv[2] ? BigInt(argv[2]) : undefined).catch((error: unknown) => {
  debug(error instanceof Error ? error.message : error);
  exit(1);
});

// #region helpers
type MarketAccount = ReadContractReturnType<typeof previewerAbi, "exactly">[number];
type UniswapArgs = { poolPair?: Address; fee?: number; pairFee?: number }; // eslint-disable-line @typescript-eslint/consistent-type-definitions
type VelodromeArgs = { poolPair?: Address; stable?: boolean; pairStable?: boolean }; // eslint-disable-line @typescript-eslint/consistent-type-definitions

function poolArgs(repayAssetSymbol: string, seizeAssetSymbol: string) {
  const [symbol0, symbol1] = [repayAssetSymbol, seizeAssetSymbol].sort() as [string, string];
  const config = POOLS?.[symbol0]?.[symbol1] ?? {};
  const {
    uniswap: {
      poolPair = repayAssetSymbol === seizeAssetSymbol
        ? repayAssetSymbol === "USDC"
          ? wethAddress
          : usdcAddress
        : zeroAddress,
      fee = 500,
      pairFee = 0,
    } = {},
    velodrome: { poolPair: velodromePoolPair = zeroAddress, stable = false, pairStable = false } = {},
  } = "velodrome" in config ? config : { uniswap: config };
  return { uniswap: [poolPair, fee, pairFee] as const, velodrome: [velodromePoolPair, stable, pairStable] as const };
}

function totalDebt({ floatingBorrowAssets, fixedBorrowPositions }: MarketAccount) {
  return floatingBorrowAssets + fixedBorrowPositions.reduce((x, p) => x + p.position.principal + p.position.fee, 0n);
}

function toUSD(assets: bigint, { decimals, usdPrice }: MarketAccount) {
  return mulDiv(assets, usdPrice, 10n ** BigInt(decimals));
}

function parseLiquidateEvent(logs: Log[] | undefined) {
  const [log, ...rest] = logs?.filter(({ topics: [selector] }) => selector === liquidateTopic) ?? [];
  if (!log) throw new Error("no liquidate event");
  if (rest.length > 0) throw new Error("multiple liquidate events");
  return decodeEventLog({ topics: log.topics, data: log.data, eventName: "Liquidate", abi: marketAbi }).args;
}

function errorName(error: unknown) {
  return error instanceof BaseError && error.cause instanceof ContractFunctionRevertedError
    ? (error.cause.reason ?? error.cause.data?.errorName ?? "")
    : "";
}
// #endregion
