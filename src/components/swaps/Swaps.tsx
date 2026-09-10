import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { router } from "expo-router";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  IdCard,
  Info,
  OctagonX,
  RefreshCw,
  Repeat,
  TriangleAlert,
} from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Checkbox, ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";

import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { parse, safeParse } from "valibot";
import {
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  parseUnits,
  zeroAddress,
} from "viem";
import { base } from "viem/chains";
import { useReadContract, useSimulateContract } from "wagmi";

import chain, { allowlists } from "@exactly/common/generated/chain";
import {
  auditorAbi,
  marketAbi,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import revertReason from "@exactly/common/revertReason";
import { Address } from "@exactly/common/validation";
import { healthFactor, max, WAD } from "@exactly/lib";

import Failure from "./Failure";
import Pending from "./Pending";
import TokenSelectModal from "./SelectorModal";
import Success from "./Success";
import SwapDetails from "./SwapDetails";
import TokenInput from "./TokenInput";
import { estimateCalls } from "../../utils/accountClient";
import alchemyChainById from "../../utils/alchemyChains";
import deployedOptions from "../../utils/deployedOptions";
import executionOptions from "../../utils/executionOptions";
import { present, presentArticle } from "../../utils/intercom";
import {
  balancesOptions,
  bridgeSlippage,
  classify,
  getAllowTokens,
  getRouteFrom,
  lifiChainsOptions,
  lifiTokensOptions,
  quoteValidity,
  statusOptions,
} from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import queryClient, { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useBeginKYC from "../../utils/useBeginKYC";
import useCrossChainGas from "../../utils/useCrossChainGas";
import useKYC from "../../utils/useKYC";
import useMarkets from "../../utils/useMarkets";
import usePortfolio from "../../utils/usePortfolio";
import useSimulateProposal from "../../utils/useSimulateProposal";
import exaConfig from "../../utils/wagmi/exa";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";
import type { Estimate, ExtendedTransactionInfo, Token } from "@lifi/sdk";

export type Swap = {
  denied: string[];
  enableSimulations: boolean;
  fromAmount: bigint;
  fromToken?: { external: boolean; token: Token };
  toAmount: bigint;
  tokenModalOpen: boolean;
  tokenSelectionType: "from" | "to";
  tool: string;
  toToken?: { external: boolean; token: Token };
};

export const defaultSwap: Swap = {
  fromToken: undefined,
  toToken: undefined,
  fromAmount: 0n,
  toAmount: 0n,
  denied: [],
  tokenSelectionType: "to",
  enableSimulations: true,
  tokenModalOpen: false,
  tool: "",
};

const SLIPPAGE_PERCENT = 5n;
const insufficientAccountLiquidity = /InsufficientAccountLiquidity|0x15d58176/;
const liquidationBuffer = (WAD * 105n) / 100n;

export default function Swaps() {
  const insets = useSafeAreaInsets();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address: account } = useAccount();
  const { allAssets, externalAssets, crossChainAssets, protocolAssets, isBalancesPending } = usePortfolio();
  const {
    error: balancesError,
    isFetching: isBalancesFetching,
    refetch: refetchBalances,
  } = useQuery(balancesOptions(account));
  const [acknowledged, setAcknowledged] = useState(false);
  const { markets, queryKey: marketsQueryKey, timestamp } = useMarkets();
  const protocolMarkets = useMemo(() => markets?.map((m) => ({ asset: m.asset, symbol: m.symbol })) ?? [], [markets]);
  const toast = useToastController();
  const beginKYC = useBeginKYC();
  const {
    approved: isKYCApproved,
    review: isKYCInReview,
    failed: isKYCFailed,
    unverified: isKYCUnverified,
    error: kycError,
    isFetched: isKYCFetched,
    isFetching: isKYCFetching,
    refetch: refetchKYC,
  } = useKYC(chain.id === base.id);
  const {
    data: homeTokens,
    isLoading: isTokensLoading,
    error: tokensError,
  } = useQuery({ queryKey: ["allowTokens", protocolMarkets], queryFn: () => getAllowTokens(protocolMarkets) });
  const { data: lifiTokens } = useQuery(lifiTokensOptions);
  const { data: lifiChains } = useQuery(lifiChainsOptions);
  const {
    data: {
      fromToken,
      toToken,
      fromAmount: inputFromAmount,
      toAmount: inputToAmount,
      denied,
      tokenSelectionType,
      enableSimulations,
      tokenModalOpen,
    } = defaultSwap,
  } = useQuery<Swap>({ queryKey: ["swap"], queryFn: () => defaultSwap, staleTime: Infinity });
  const fromChain = (fromToken?.token.chainId as number | undefined) ?? chain.id;
  const toChain = (toToken?.token.chainId as number | undefined) ?? chain.id;
  const crossChain = fromChain !== toChain;

  const allowedChains = useMemo(
    () =>
      Object.keys(allowlists)
        .map(Number)
        .filter((id) => Number.isInteger(id) && (id === chain.id || alchemyChainById.has(id))),
    [],
  );
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const deployedFactories = useQueries({
    queries: allowedChains.map((chainId) => deployedOptions(credential?.factory, chainId)),
    combine: (results) =>
      new Set(allowedChains.filter((chainId, index) => chainId === chain.id || results[index]?.data === true)),
  });
  const networks = useMemo(
    () =>
      allowedChains
        .filter((id) => deployedFactories.has(id))
        .map((id) => ({ id, name: lifiChains?.find((item) => item.id === id)?.name ?? String(id) }))
        .sort((a, b) => {
          if (a.id === chain.id) return -1;
          if (b.id === chain.id) return 1;
          return a.name.localeCompare(b.name);
        }),
    [allowedChains, deployedFactories, lifiChains],
  );

  const isExternal = useCallback(
    (chainId: number, address: string) => {
      if (chainId !== chain.id) return true;
      if (!markets) return false;
      return !markets.some((m) => m.asset === address);
    },
    [markets],
  );

  const getSwapAddress = useCallback(
    (token: undefined | { external: boolean; token: Token }) => {
      if (!token) return;
      if (token.external) return parse(Address, token.token.address);
      return protocolAssets.find((a) => a.asset === token.token.address)?.market;
    },
    [protocolAssets],
  );

  const getBalance = useCallback(
    (token?: Token) => {
      if (!token) return 0n;
      const address = parse(Address, token.address);
      const tokenChain = token.chainId as number;
      if (tokenChain !== chain.id) {
        return crossChainAssets.find((a) => a.chainId === tokenChain && a.address === address)?.amount ?? 0n;
      }
      if (isExternal(tokenChain, token.address)) {
        return externalAssets.find((a) => a.address === address)?.amount ?? 0n;
      }
      return protocolAssets.find((a) => a.asset === address)?.floatingDepositAssets ?? 0n;
    },
    [crossChainAssets, externalAssets, isExternal, protocolAssets],
  );

  const candidates = useMemo(() => {
    const reachable = new Set(networks.map(({ id }) => id));
    return [
      ...(homeTokens ?? []),
      ...(lifiTokens ?? []).filter(
        (token) => (token.chainId as number) !== chain.id && reachable.has(token.chainId as number),
      ),
    ];
  }, [homeTokens, lifiTokens, networks]);

  const held = useMemo(
    () =>
      new Set(
        allAssets
          .filter((asset) =>
            asset.type === "protocol"
              ? asset.floatingDepositAssets > 0n
              : (asset.amount ?? 0n) > 0n && isExternal(asset.chainId, asset.address),
          )
          .map((asset) =>
            asset.type === "protocol" ? `${chain.id}:${asset.asset}` : `${asset.chainId}:${asset.address}`,
          ),
      ),
    [allAssets, isExternal],
  );
  const payableTokens = useMemo(
    () => candidates.filter((token) => held.has(`${token.chainId}:${token.address}`)),
    [candidates, held],
  );

  useEffect(() => {
    if (!markets || !homeTokens || (fromToken && toToken)) return;
    updateSwap((old) => {
      const home = payableTokens.filter((token) => (token.chainId as number) === chain.id);
      const preferred = home.length > 0 ? home : payableTokens;
      const payable = old.fromToken?.token ?? preferred.find(({ symbol }) => symbol === "USDC") ?? preferred[0];
      const target =
        old.toToken?.token ??
        ["EXA", "WETH", "USDC"]
          .map((symbol) => homeTokens.find((token) => token.symbol === symbol))
          .find((token) => token !== undefined && !sameToken(token, payable)) ??
        homeTokens.find((token) => !sameToken(token, payable));
      return {
        ...old,
        fromToken: payable ? { token: payable, external: isExternal(payable.chainId, payable.address) } : undefined,
        toToken: target ? { token: target, external: isExternal(target.chainId, target.address) } : undefined,
      };
    });
  }, [fromToken, homeTokens, isExternal, markets, payableTokens, toToken]);

  const processing = chain.id === base.id && isKYCInReview;
  const failed = chain.id === base.id && isKYCFailed;

  const unverified = chain.id === base.id && isKYCFetched && isKYCUnverified;

  const unavailable =
    chain.id === base.id && isKYCFetched && (!!kycError || !isKYCApproved) && !processing && !failed && !unverified;

  const balancesUnavailable =
    !!balancesError && !isTokensLoading && fromChain === chain.id && !fromToken && payableTokens.length === 0;

  const empty =
    !isTokensLoading &&
    !tokensError &&
    !isBalancesPending &&
    !balancesError &&
    !!markets &&
    fromChain === chain.id &&
    !fromToken &&
    payableTokens.length === 0;

  const handleTokenSelect = (selected: Token) => {
    if (!fromToken || !toToken) return;
    updateSwap((old) => ({
      ...old,
      fromAmount: tokenSelectionType === "to" && !sameToken(selected, fromToken.token) ? fromAmount : 0n,
      toAmount: 0n,
      denied: [],
      fromToken:
        tokenSelectionType === "from"
          ? { token: selected, external: isExternal(selected.chainId, selected.address) }
          : sameToken(selected, fromToken.token)
            ? { token: toToken.token, external: toToken.external }
            : fromToken,
      toToken:
        tokenSelectionType === "to"
          ? { token: selected, external: isExternal(selected.chainId, selected.address) }
          : sameToken(selected, toToken.token)
            ? { token: fromToken.token, external: fromToken.external }
            : toToken,
      tokenModalOpen: false,
    }));
  };

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const handleAmountChange = (value: bigint) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!fromToken) return;
      updateSwap((old) => ({ ...old, fromAmount: value, denied: [] }));
    }, 400);
  };

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ["swap"] });
    };
  }, []);

  const {
    data: route,
    dataUpdatedAt: routeUpdatedAt,
    error: routeError,
    errorUpdatedAt: routeErroredAt,
    errorUpdateCount: routeErrors,
    isFetching: isRouteFetching,
    isLoading: isRouteLoading,
  } = useQuery({
    queryKey: ["lifi", "route", account, fromChain, fromToken, toChain, toToken, crossChain, inputFromAmount, denied],
    queryFn: async () => {
      if (!account || !fromToken || !toToken) throw new Error("implementation error");
      const fromTokenAddress = parse(Address, fromToken.token.address);
      const toTokenAddress = parse(Address, toToken.token.address);
      const denyExchanges = denied.length > 0 ? Object.fromEntries(denied.map((item) => [item, true])) : undefined;
      try {
        return await getRouteFrom({
          fromChainId: fromChain,
          toChainId: toChain,
          fromTokenAddress,
          toTokenAddress,
          fromAmount: inputFromAmount,
          fromAddress: account,
          toAddress: account,
          nativeless: !fromToken.external, // cspell:ignore nativeless
          denyBridges: crossChain ? denied : undefined,
          denyExchanges: crossChain ? undefined : denyExchanges,
        });
      } catch (error: unknown) {
        reportError(error, {
          level: "warning",
          extra: { lifi: (error as { cause?: { responseBody?: unknown } }).cause?.responseBody },
        });
        throw error;
      }
    },
    enabled: enableSimulations && !!account && !!fromToken && !!toToken && !!inputFromAmount,
    refetchInterval: ({ state }) => (state.error && classify(state.error) !== "quote" ? false : 20_000),
    retry: false,
    staleTime: 10_000,
    meta: { dropError: () => true },
  });

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!routeUpdatedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [routeUpdatedAt]);
  const quoteExpired = !!route && now >= routeUpdatedAt + quoteValidity;

  const fromAmount = inputFromAmount;
  const toAmount = route?.toAmount ?? inputToAmount;
  const tool = route?.tool ?? "";

  const isInsufficientBalance = useMemo(() => {
    if (!fromToken) return false;
    return fromAmount > getBalance(fromToken.token);
  }, [fromToken, fromAmount, getBalance]);

  const neutralAsset = useMemo(() => {
    const { success, output } = safeParse(
      Address,
      markets?.find(({ asset }) => asset !== fromToken?.token.address)?.asset,
    );
    return success ? output : undefined;
  }, [markets, fromToken]);

  const {
    request: swapPropose,
    error: swapExecuteProposalError,
    isPending: isSimulatingSwap,
  } = useSimulateProposal({
    account,
    amount: fromAmount,
    market: getSwapAddress(fromToken),
    proposalType: ProposalType.Swap,
    assetOut: crossChain ? neutralAsset : parse(Address, toToken?.token.address ?? zeroAddress),
    minAmountOut: crossChain ? 0n : (toAmount * (WAD * (1000n - SLIPPAGE_PERCENT))) / 1000n / WAD,
    route: route?.data,
    enabled:
      enableSimulations &&
      !!account &&
      !!fromToken &&
      !!toToken &&
      !!fromAmount &&
      fromAmount > 0n &&
      !!toAmount &&
      toAmount > 0n &&
      !!route &&
      !isInsufficientBalance &&
      !fromToken.external &&
      (!crossChain || !!neutralAsset),
  });

  const {
    data: externalSwap,
    error: externalSwapError,
    isPending: isSimulatingExternalSwap,
  } = useSimulateContract({
    address: account,
    chainId: chain.id,
    functionName: "swap",
    args: [
      parse(Address, fromToken?.token.address ?? zeroAddress),
      parse(Address, toToken?.token.address ?? zeroAddress),
      fromAmount,
      (toAmount * (WAD * (1000n - SLIPPAGE_PERCENT))) / 1000n / WAD,
      route?.data ?? "0x",
    ],
    abi: [
      ...auditorAbi,
      ...marketAbi,
      ...upgradeableModularAccountAbi,
      {
        type: "function",
        inputs: [
          { name: "assetIn", internalType: "contract IERC20", type: "address" },
          { name: "assetOut", internalType: "contract IERC20", type: "address" },
          { name: "maxAmountIn", internalType: "uint256", type: "uint256" },
          { name: "minAmountOut", internalType: "uint256", type: "uint256" },
          { name: "route", internalType: "bytes", type: "bytes" },
        ],
        name: "swap",
        outputs: [
          { name: "amountIn", internalType: "uint256", type: "uint256" },
          { name: "amountOut", internalType: "uint256", type: "uint256" },
        ],
        stateMutability: "nonpayable",
      },
    ],
    query: {
      enabled:
        enableSimulations &&
        !!account &&
        !!fromToken &&
        !!toToken &&
        !!fromAmount &&
        fromAmount > 0n &&
        !!toAmount &&
        toAmount > 0n &&
        !!route &&
        fromToken.external &&
        !crossChain &&
        fromChain === chain.id &&
        !isInsufficientBalance,
    },
  });

  const routed = !!fromToken?.external && (crossChain || fromChain !== chain.id);

  const {
    data: routedSwap,
    error: routedError,
    isPending: isSimulatingRouted,
  } = useQuery({
    queryKey: ["lifi", "route", "calls", account, fromChain, fromToken, route],
    queryFn: async () => {
      if (!account || !fromToken || !route?.to) throw new Error("implementation error");
      const call = { to: route.to, data: route.data, value: route.value };
      const calls: { data: `0x${string}`; to: `0x${string}`; value?: bigint }[] = await (async () => {
        if (fromToken.token.address === zeroAddress) return [call];
        const spender = getAddress(route.estimate.approvalAddress);
        const required = BigInt(route.estimate.fromAmount);
        const token = getAddress(fromToken.token.address);
        const allowance = await readContract(exaConfig, {
          address: token,
          chainId: fromChain,
          abi: erc20Abi,
          functionName: "allowance",
          args: [account, spender],
        });
        return [
          ...(allowance >= required ? [] : allowance > 0n ? [0n, required] : [required]).map((value) => ({
            to: token,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, value] }),
          })),
          call,
        ];
      })();
      return { calls, gas: await estimateCalls(exaConfig, fromChain, calls) };
    },
    enabled: enableSimulations && routed && !!account && !!route && !isInsufficientBalance,
    retry: false,
    meta: { dropError: () => true },
  });

  const prepareError = fromToken?.external ? (routed ? routedError : externalSwapError) : swapExecuteProposalError;
  const wrapped = !!route && "wrapped" in route && route.wrapped === true;
  const { data: dust } = useReadContract({
    address: wrapped && fromToken ? parse(Address, fromToken.token.address) : undefined,
    chainId: fromChain,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: route?.to ? [route.to] : undefined,
    query: { enabled: wrapped, refetchInterval: quoteValidity / 3 },
  });
  const stalled = !!prepareError && wrapped && !!dust && dust > 0n;
  const insufficientCollateral =
    !!prepareError && insufficientAccountLiquidity.test(revertReason(prepareError, { fallback: "message" }));

  const isSimulating = fromToken?.external
    ? routed
      ? isSimulatingRouted
      : isSimulatingExternalSwap
    : isSimulatingSwap;

  useEffect(() => {
    if (!prepareError) return;
    reportError(prepareError, { level: "warning" });
    if (!tool || stalled || insufficientCollateral) return;
    updateSwap((old) => ({
      ...old,
      denied: old.denied.includes(tool) ? old.denied : [...old.denied, tool].slice(0, 3),
    }));
  }, [insufficientCollateral, prepareError, stalled, tool]);
  const rerouting = denied.length > 0 && !route && isRouteFetching;
  const transient =
    !!routeError &&
    classify(routeError) === "quote" &&
    (route ? routeErroredAt < routeUpdatedAt + quoteValidity : routeErrors < 3);
  const failure =
    routeError && !transient
      ? classify(routeError)
      : prepareError
        ? insufficientCollateral
          ? "collateral"
          : stalled || (tool && denied.length < 3 && !denied.includes(tool))
            ? undefined
            : "route"
        : undefined;

  const nativeToken = lifiChains?.find((item) => item.id === fromChain)?.nativeToken;
  const fromNetworkName = lifiChains?.find((item) => item.id === fromChain)?.name;
  const networkName = lifiChains?.find((item) => item.id === toChain)?.name;
  const sponsored = fromChain === chain.id;
  const networkCost = sponsored ? 0n : routedSwap?.gas;
  const networkFeeUSD = sponsored
    ? 0
    : networkCost !== undefined && nativeToken
      ? Number(formatUnits(networkCost, nativeToken.decimals)) * Number(nativeToken.priceUSD)
      : undefined;
  const gasSource = useMemo(
    () => (fromToken?.external ? { ...fromToken.token, amount: getBalance(fromToken.token) } : null),
    [fromToken, getBalance],
  );
  const { erc20GasReserve, feeIsSource, gasToken, insufficientGas, nativeGasReserve, paymasterAddress, sendCalls } =
    useCrossChainGas({
      account,
      amount: fromAmount,
      chainId: fromChain,
      networkCost,
      token: gasSource,
      value: routed ? (route?.value ?? 0n) : undefined,
    });

  const resultRef = useRef<{
    duration?: number;
    fromAmount: bigint;
    fromToken?: Token;
    networkFeeUSD?: number;
    toAmount: bigint;
    tool: string;
    toToken?: Token;
  }>({ fromAmount: 0n, toAmount: 0n, tool: "" });
  const {
    mutate: swap,
    data: receipt,
    isPending: isSwapping,
    isSuccess: isSwapSuccess,
    error: writeContractError,
    reset: resetSwap,
  } = useMutation({
    mutationFn() {
      if (!route) throw new Error("no route");
      const calls = (() => {
        if (!fromToken?.external) {
          if (!swapPropose) throw new Error("no swap proposal simulation");
          const { address, abi, functionName, args } = swapPropose;
          return [{ to: address, data: encodeFunctionData({ abi, functionName, args }) }];
        }
        if (!routed) {
          if (!externalSwap) throw new Error("no external swap simulation");
          const { address, abi, functionName, args } = externalSwap.request;
          return [{ to: address, data: encodeFunctionData({ abi, functionName, args }) }];
        }
        if (!routedSwap) throw new Error("no routed swap simulation");
        return routedSwap.calls;
      })();
      return sendCalls(calls);
    },
    onMutate() {
      resultRef.current = {
        duration: route?.estimate.executionDuration,
        fromAmount,
        fromToken: fromToken?.token,
        networkFeeUSD,
        toAmount,
        toToken: toToken?.token,
        tool,
      };
      updateSwap((old) => ({ ...old, enableSimulations: false }));
    },
    onSuccess() {
      queryClient.invalidateQueries({ queryKey: ["lifi", "balances"] }).catch(reportError);
      queryClient.invalidateQueries({ queryKey: marketsQueryKey }).catch(reportError);
      updateSwap((old) => ({ ...old, fromAmount: 0n, toAmount: 0n }));
    },
    onSettled() {
      queryClient.removeQueries({ queryKey: ["lifi", "route"] });
      updateSwap((old) => ({ ...old, enableSimulations: true }));
    },
    onError(error) {
      if (reportError(error).authKnown) resetSwap();
    },
  });

  const proposal = useMemo(() => {
    if (!receipt) return;
    const [topic] = encodeEventTopics({ abi: proposalManagerAbi, eventName: "Proposed" });
    const nonce = receipt.logs.find(({ topics }) => topics[0] === topic)?.topics[2];
    return nonce ? { nonce: BigInt(nonce), since: receipt.blockNumber } : undefined;
  }, [receipt]);
  const { data: execution } = useQuery(executionOptions(account, proposal?.nonce, proposal?.since));
  const executionHash = execution?.executed ? execution.hash : undefined;
  const { data: routeStatus } = useQuery(
    statusOptions(
      routed || crossChain ? (proposal ? executionHash : receipt?.transactionHash) : undefined,
      toChain,
      tool || resultRef.current.tool || undefined,
      fromChain,
      resultRef.current.duration,
    ),
  );
  const delivered = !crossChain || routeStatus?.status === "DONE";
  const undelivered =
    crossChain &&
    (execution?.executed === false || routeStatus?.status === "FAILED" || routeStatus?.substatus === "REFUNDED"); // cspell:ignore substatus
  useEffect(() => {
    if (!executionHash && routeStatus?.status !== "DONE") return;
    queryClient.invalidateQueries({ queryKey: ["lifi", "balances"] }).catch(reportError);
    queryClient.invalidateQueries({ queryKey: marketsQueryKey }).catch(reportError);
  }, [executionHash, routeStatus?.status]); // eslint-disable-line @eslint-react/exhaustive-deps -- wagmi query key changes every render

  const projectedHealth = useMemo(() => {
    if (!markets || !fromToken || fromToken.external || fromAmount === 0n) return;
    const fromMarket = getSwapAddress(fromToken);
    if (!fromMarket) return;
    return healthFactor(
      markets.map((item) =>
        item.market === fromMarket
          ? { ...item, floatingDepositAssets: max(0n, item.floatingDepositAssets - fromAmount) }
          : item,
      ),
      Number(timestamp),
    );
  }, [fromAmount, fromToken, getSwapAddress, markets, timestamp]);
  const caution = projectedHealth !== undefined && projectedHealth < liquidationBuffer;
  const danger = projectedHealth !== undefined && projectedHealth < WAD;

  const shortfallFee =
    insufficientGas && nativeToken
      ? gasToken && feeIsSource && paymasterAddress && erc20GasReserve > 0n
        ? { reserve: erc20GasReserve, token: gasToken, network: undefined }
        : {
            reserve: (routed ? (route?.value ?? 0n) : 0n) + nativeGasReserve,
            token: nativeToken,
            network: fromNetworkName ?? String(fromChain),
          }
      : undefined;
  const shortfall = shortfallFee
    ? t(
        shortfallFee.network
          ? "You need ~{{amount}} {{symbol}} on {{network}} for network fees."
          : "Keep ~{{amount}} {{symbol}} for network fees.",
        {
          amount: Number(formatUnits(shortfallFee.reserve, shortfallFee.token.decimals)).toLocaleString(language, {
            minimumFractionDigits: 0,
            maximumFractionDigits: shortfallFee.token.decimals,
            useGrouping: false,
          }),
          symbol: shortfallFee.token.symbol,
          network: shortfallFee.network,
        },
      )
    : undefined;

  const showWarning = fromToken && !fromToken.external && fromAmount > 0n && (caution || danger);
  const disabled =
    !route ||
    quoteExpired ||
    isSimulating ||
    rerouting ||
    stalled ||
    !!failure ||
    isInsufficientBalance ||
    insufficientGas ||
    danger;
  const buttonLabel = useMemo(() => {
    if (isInsufficientBalance) return t("Insufficient balance");
    if (insufficientGas) return t("Not enough for network fees");
    if (rerouting || quoteExpired || (isSimulating && route)) return t("Please wait...");
    if (failure) return t("Cannot proceed");
    if (danger) return t("Enter a lower amount to swap");
    if (fromToken && toToken) {
      return t("Swap {{from}} for {{to}}", { from: fromToken.token.symbol, to: toToken.token.symbol });
    }
    return t("Swap");
  }, [
    isSimulating,
    rerouting,
    quoteExpired,
    route,
    isInsufficientBalance,
    insufficientGas,
    failure,
    danger,
    fromToken,
    toToken,
    t,
  ]);

  if (!isSwapping && !isSwapSuccess && !writeContractError)
    return (
      <SafeView fullScreen backgroundColor="$backgroundSoft">
        <View
          padded
          flexDirection="row"
          gap="$s3_5"
          paddingBottom="$s4"
          justifyContent="space-between"
          alignItems="center"
        >
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(main)/(home)/defi");
              }
            }}
          />
          <Text primary emphasized subHeadline>
            {t("Swaps")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("11757863").catch(reportError);
            }}
          />
        </View>
        {chain.id === base.id && !isKYCFetched ? (
          <YStack flex={1} justifyContent="center" alignItems="center" padding="$s4">
            <Spinner size="large" color="$uiBrandSecondary" />
          </YStack>
        ) : processing ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <IdCard size={48} color="$uiBrandSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("Verification in review")}
            </Text>
            <Text secondary footnote textAlign="center">
              {t("Your identity verification is under review. We'll let you know once it's been processed.")}
            </Text>
          </YStack>
        ) : failed ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <IdCard size={48} color="$uiBrandSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("We couldn’t verify your identity")}
            </Text>
            <Text secondary footnote textAlign="center">
              {t("This may be due to missing or incorrect information. Please contact support to resolve it.")}
            </Text>
            <Button
              primary
              marginTop="$s4"
              onPress={() => {
                present().catch(reportError);
              }}
            >
              <Button.Text>{t("Contact support")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </YStack>
        ) : unavailable ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <TriangleAlert size={48} color="$uiNeutralSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("An error occurred. Please try again later.")}
            </Text>
            <Button
              primary
              marginTop="$s4"
              loading={isKYCFetching}
              disabled={isKYCFetching}
              onPress={() => {
                refetchKYC().catch(reportError);
              }}
            >
              <Button.Text>{t("Retry")}</Button.Text>
              <Button.Icon>
                <RefreshCw />
              </Button.Icon>
            </Button>
          </YStack>
        ) : unverified ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <IdCard size={48} color="$uiBrandSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("Verify your identity")}
            </Text>
            <Text secondary footnote textAlign="center">
              {t("Complete identity verification to start swapping.")}
            </Text>
            <Button
              primary
              marginTop="$s4"
              loading={beginKYC.isPending}
              disabled={beginKYC.isPending}
              onPress={() => {
                beginKYC.mutate(undefined, {
                  onSuccess(result) {
                    if (result.status === "complete") router.replace("/(main)/(home)");
                    else if (result.status === "blocked") router.push("/(main)/getting-started");
                  },
                  onError(error) {
                    if (error instanceof APIError && error.text === "failed") {
                      refetchKYC().catch(reportError);
                      return;
                    }
                    toast.show(t("Error verifying identity"), {
                      native: true,
                      duration: 1000,
                      burntOptions: { haptic: "error", preset: "error" },
                    });
                    reportError(error);
                  },
                });
              }}
            >
              <Button.Text>{t("Begin verifying")}</Button.Text>
              <Button.Icon>
                <IdCard />
              </Button.Icon>
            </Button>
          </YStack>
        ) : balancesUnavailable ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <TriangleAlert size={48} color="$uiNeutralSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("An error occurred. Please try again later.")}
            </Text>
            <Button
              primary
              marginTop="$s4"
              loading={isBalancesFetching}
              disabled={isBalancesFetching}
              onPress={() => {
                refetchBalances().catch(reportError);
              }}
            >
              <Button.Text>{t("Retry")}</Button.Text>
              <Button.Icon>
                <RefreshCw />
              </Button.Icon>
            </Button>
          </YStack>
        ) : empty ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <TriangleAlert size={48} color="$uiNeutralSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("Nothing to swap yet")}
            </Text>
            <Text secondary footnote textAlign="center">
              {t("Deposit assets to start swapping.")}
            </Text>
          </YStack>
        ) : (
          <>
            <ScrollView ref={swapsScrollReference} showsVerticalScrollIndicator={false} flex={1}>
              <View padded>
                <YStack paddingBottom="$s3" gap="$s4_5">
                  <YStack gap="$s3_5">
                    {(["from", "to"] as const).map((type) => {
                      const paying = type === "from";
                      const tokenData = paying ? fromToken : toToken;
                      return (
                        <TokenInput
                          key={type}
                          label={t(paying ? "You pay" : "You receive")}
                          token={tokenData?.token}
                          amount={paying ? fromAmount : toAmount}
                          balance={getBalance(tokenData?.token)}
                          disabled={!paying}
                          isLoading={isTokensLoading || (isRouteLoading && !fromAmount)}
                          isActive={paying}
                          isDanger={paying && showWarning}
                          onTokenSelect={() => {
                            updateSwap((old) => ({ ...old, tokenSelectionType: type, tokenModalOpen: true }));
                            setAcknowledged(false);
                          }}
                          onFocus={() => {
                            setAcknowledged(false);
                          }}
                          onChange={
                            paying
                              ? (value: bigint) => {
                                  handleAmountChange(value);
                                  setAcknowledged(false);
                                }
                              : undefined
                          }
                          onUseMax={
                            paying
                              ? (value: bigint) => {
                                  handleAmountChange(value);
                                  setAcknowledged(false);
                                }
                              : undefined
                          }
                          usdValue={quotedUSD(route?.estimate, type)}
                        />
                      );
                    })}
                  </YStack>
                  {fromToken && toToken && route && (
                    <SwapDetails
                      exchange={tool}
                      fee={route.estimate.feeCosts?.reduce((sum, { percentage }) => sum + (Number(percentage) || 0), 0)}
                      slippage={crossChain || routed ? BigInt(bridgeSlippage * 1000) : SLIPPAGE_PERCENT}
                      exchangeRate={getExchangeRate(fromToken.token, toToken.token, fromAmount, toAmount)}
                      fromToken={fromToken.token}
                      toToken={toToken.token}
                      networkFeeUSD={networkFeeUSD}
                      duration={crossChain ? route.estimate.executionDuration : undefined}
                    />
                  )}
                </YStack>
              </View>
            </ScrollView>
            <YStack padding="$s4" paddingBottom={insets.bottom} $platform-web={{ paddingBottom: "$s4" }} gap="$s3">
              <YStack gap="$s3">
                {(caution || danger) && showWarning && (
                  <YStack gap="$s4_5">
                    <Separator borderColor={danger ? "$borderErrorStrong" : "$borderNeutralSoft"} />
                    <XStack
                      gap="$s3"
                      alignItems="center"
                      cursor="pointer"
                      onPress={() => {
                        setAcknowledged(!acknowledged);
                      }}
                    >
                      {danger ? (
                        <TriangleAlert size={16} color="$uiErrorSecondary" />
                      ) : (
                        <Checkbox
                          pointerEvents="none"
                          borderColor="$backgroundBrand"
                          backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                          checked={acknowledged}
                        >
                          <Checkbox.Indicator>
                            <Check size={16} color="$uiNeutralPrimary" />
                          </Checkbox.Indicator>
                        </Checkbox>
                      )}
                      <Text caption color={danger ? "$uiErrorSecondary" : "$uiNeutralSecondary"} flex={1}>
                        {danger
                          ? t(
                              "Swapping this much of your collateral could instantly trigger liquidation. Try a smaller amount to stay protected.",
                            )
                          : t("I acknowledge the risks of swapping this much of my collateral assets.")}
                      </Text>
                    </XStack>
                    <Separator borderColor="$borderNeutralSoft" />
                  </YStack>
                )}
                {(!!failure || insufficientGas || rerouting || transient) && (
                  <XStack
                    gap="$s4"
                    alignItems="center"
                    backgroundColor={
                      failure || insufficientGas
                        ? "$interactiveBaseErrorSoftDefault"
                        : "$interactiveBaseInformationSoftDefault"
                    }
                    borderRadius="$r3"
                    paddingHorizontal="$s4"
                    paddingVertical="$s3"
                  >
                    {failure || insufficientGas ? (
                      <OctagonX size={16} color="$uiErrorSecondary" />
                    ) : (
                      <Info size={16} color="$uiInfoSecondary" />
                    )}
                    <Text
                      caption2
                      color={failure || insufficientGas ? "$uiErrorSecondary" : "$uiInfoSecondary"}
                      flex={1}
                    >
                      {failure === "collateral"
                        ? t(
                            "This swap would leave your collateral below what your debt requires. Try a smaller amount.",
                          )
                        : failure === "route"
                          ? t("No route available for this swap. Try a different asset or network.")
                          : failure === "liquidity"
                            ? t("Not enough liquidity for this amount currently. Try a different amount.")
                            : failure
                              ? t("We can’t get a quote right now. Try again in a moment.")
                              : (shortfall ?? (rerouting ? t("Trying another route...") : t("Retrying quote...")))}
                    </Text>
                  </XStack>
                )}
                <XStack alignItems="flex-start" flexWrap="wrap" paddingBottom="$s3">
                  <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                    <Trans
                      i18nKey="Swap functionality is provided via <link>LI.FI</link> and executed on decentralized networks. Availability and pricing depend on network conditions and third-party protocols."
                      components={{
                        link: (
                          <Text
                            cursor="pointer"
                            caption2
                            color="$interactiveOnDisabled"
                            textDecorationLine="underline"
                            onPress={() => {
                              openBrowser(`https://li.fi/`).catch(reportError);
                            }}
                          />
                        ),
                      }}
                    />
                  </Text>
                </XStack>
              </YStack>
              <Button
                primary={!(caution && acknowledged)}
                dangerSecondary={caution && acknowledged}
                disabled={disabled || (caution && !acknowledged)}
                loading={!danger && isSimulating && !!route && !isInsufficientBalance}
                width="100%"
                onPress={() => {
                  swap();
                }}
              >
                <Button.Text>{buttonLabel}</Button.Text>
                <Button.Icon>{danger ? <TriangleAlert /> : <Repeat />}</Button.Icon>
              </Button>
            </YStack>
            <TokenSelectModal
              key={`${tokenSelectionType}:${fromChain}:${toChain}`}
              withBalanceOnly={tokenSelectionType === "from"}
              open={tokenModalOpen}
              tokens={candidates}
              networks={networks}
              chainId={tokenSelectionType === "from" ? fromChain : toChain}
              selectedToken={tokenSelectionType === "from" ? fromToken?.token : toToken?.token}
              onSelect={handleTokenSelect}
              onClose={() => updateSwap((old) => ({ ...old, tokenModalOpen: false }))}
              isLoading={isTokensLoading}
              title={tokenSelectionType === "from" ? t("Select token to pay") : t("Select token to receive")}
            />
          </>
        )}
      </SafeView>
    );
  {
    const { fromAmount: resultFromAmount, fromToken: paid } = resultRef.current;
    const settled =
      routeStatus && "receiving" in routeStatus ? (routeStatus.receiving as ExtendedTransactionInfo) : undefined;
    const received = settled?.token && settled.amount ? settled.token : resultRef.current.toToken;
    if (!paid || !received) return null;
    const resultToAmount = settled?.token && settled.amount ? BigInt(settled.amount) : resultRef.current.toAmount;
    const properties = {
      fromUsdAmount: Number(formatUnits((resultFromAmount * parseUnits(paid.priceUSD, 18)) / WAD, paid.decimals)),
      fromAmount: resultFromAmount,
      fromToken: paid,
      toUsdAmount: Number(formatUnits((resultToAmount * parseUnits(received.priceUSD, 18)) / WAD, received.decimals)),
      toAmount: resultToAmount,
      toToken: received,
    };
    if (isSwapping || (isSwapSuccess && !delivered && !undelivered))
      return (
        <Pending
          {...properties}
          network={crossChain ? networkName : undefined}
          onClose={() => {
            onClose();
          }}
        />
      );
    if (isSwapSuccess && !undelivered)
      return (
        <Success
          {...properties}
          chainId={fromChain}
          completed={!!fromToken?.external || crossChain}
          fee={
            resultRef.current.networkFeeUSD
              ? `$${resultRef.current.networkFeeUSD.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : undefined
          }
          hash={executionHash ?? receipt?.transactionHash}
          onClose={() => {
            onClose();
          }}
        />
      );
    return (
      <Failure
        {...properties}
        onClose={() => {
          onClose();
        }}
      />
    );
  }
}

function onClose() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/(main)/(home)");
  }
}

function sameToken(token: Token, other?: Token) {
  return !!other && token.chainId === other.chainId && token.address === other.address;
}

function getExchangeRate(fromToken: Token, toToken: Token, fromAmount: bigint, toAmount: bigint) {
  return Number(formatUnits(toAmount, toToken.decimals)) / Number(formatUnits(fromAmount, fromToken.decimals));
}

function updateSwap(updater: (old: Swap) => Swap) {
  queryClient.setQueryData<Swap>(["swap"], (old) => updater(old ?? defaultSwap));
}

export const swapsScrollReference: RefObject<null | ScrollView> = { current: null };

function quotedUSD(estimate: Estimate | undefined, type: "from" | "to") {
  const quoted = type === "from" ? estimate?.fromAmountUSD : estimate?.toAmountUSD;
  return quoted === undefined ? undefined : Number(quoted) || undefined;
}
