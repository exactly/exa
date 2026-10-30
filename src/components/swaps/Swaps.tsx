import React, { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Trans, useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";

import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ChartNoAxesCombined,
  Check,
  CircleHelp,
  Coins,
  Headphones,
  IdCard,
  Info,
  OctagonX,
  RefreshCw,
  Repeat,
  TriangleAlert,
} from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";

import { useMutation, useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { readContract } from "@wagmi/core/actions";
import { parse, safeParse } from "valibot";
import { BaseError, encodeEventTopics, encodeFunctionData, erc20Abi, formatUnits, getAddress, zeroAddress } from "viem";
import { base } from "viem/chains";
import { useReadContract, useSimulateContract } from "wagmi";

import chain, { alchemyChains, allowlists } from "@exactly/common/generated/chain";
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
import { DeploymentError, estimateCalls } from "../../utils/accountClient";
import deployedOptions, { requestDeployment } from "../../utils/deployedOptions";
import executionOptions from "../../utils/executionOptions";
import { present, presentArticle } from "../../utils/intercom";
import {
  balancesOptions,
  bridgeSlippage,
  classify,
  getAllowTokens,
  getRouteFrom,
  isStock,
  lifiChainsOptions,
  lifiTokensOptions,
  marketOpen,
  quoteValidity,
  restrictedCountries,
  statusOptions,
} from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import parseAmount from "../../utils/parseAmount";
import { useFeed } from "../../utils/prices";
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
import Checkbox from "../shared/Checkbox";
import IconButton from "../shared/IconButton";
import MarketClosedBanner from "../shared/MarketClosedBanner";
import { PriceSummary } from "../shared/PriceChart";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Tabs from "../shared/Tabs";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";
import type { Estimate, ExtendedTransactionInfo, Token } from "@lifi/sdk";

export type Swap = {
  denied: string[];
  enableSimulations: boolean;
  fromAmount: bigint;
  fromToken?: { external: boolean; token: Token };
  mode?: "crypto" | "stocks";
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
const liquidationRisk = (WAD * 105n) / 100n;
const liquidationCaution = (WAD * 115n) / 100n;

export default function Swaps() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address: account } = useAccount();
  const { allAssets, externalAssets, crossChainAssets, protocolAssets, isExternal, isBalancesPending } = usePortfolio();
  const {
    error: balancesError,
    isFetching: isBalancesFetching,
    refetch: refetchBalances,
  } = useQuery(balancesOptions(account));
  const [acknowledged, setAcknowledged] = useState(false);
  const [flips, setFlips] = useState(0);
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
  const { data: country } = useQuery<string>({ queryKey: ["user", "country"] });
  const restricted = restrictedCountries.has(country ?? "");
  const {
    data: homeTokens,
    isLoading: isTokensLoading,
    error: tokensError,
  } = useQuery({ queryKey: ["allowTokens", protocolMarkets], queryFn: () => getAllowTokens(protocolMarkets) });
  const { data: lifiTokens, isLoading: isLifiLoading } = useQuery(lifiTokensOptions);
  const {
    data: lifiChains,
    error: chainsError,
    isLoading: isChainsLoading,
    isFetching: isChainsFetching,
    refetch: refetchChains,
  } = useQuery(lifiChainsOptions);
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
      mode,
    },
  } = useQuery<Swap>({ queryKey: ["swap"], queryFn: () => defaultSwap, initialData: defaultSwap, staleTime: Infinity });
  const { filter } = useLocalSearchParams();
  const fromChain = (fromToken?.token.chainId as number | undefined) ?? chain.id;
  const toChain = (toToken?.token.chainId as number | undefined) ?? chain.id;
  const crossChain = fromChain !== toChain;

  const allowedChains = useMemo(
    () =>
      Object.keys(allowlists)
        .map(Number)
        .filter((id) => Number.isInteger(id) && (id === chain.id || alchemyChains.has(id))),
    [],
  );
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: stocksTabSeen } = useQuery<boolean>({ queryKey: ["settings", "stocks-tab-seen"] });
  const { deployedFactories, isBaseLoading } = useQueries({
    queries: allowedChains.map((chainId) => deployedOptions(credential?.factory, chainId)),
    combine: useCallback(
      (results: UseQueryResult<boolean>[]) => {
        const result = results[allowedChains.indexOf(base.id)];
        return {
          deployedFactories: new Set(
            allowedChains.filter((chainId, index) => chainId === chain.id || results[index]?.data === true),
          ),
          isBaseLoading: !!result?.isLoading,
        };
      },
      [allowedChains],
    ),
  });
  const networks = useMemo(
    () =>
      allowedChains
        .filter((id) => deployedFactories.has(id))
        .flatMap((id) => {
          const name = lifiChains?.find((item) => item.id === id)?.name ?? (id === chain.id ? chain.name : undefined);
          return name ? [{ id, name }] : [];
        })
        .sort((a, b) => {
          if (a.id === base.id) return -1;
          if (b.id === base.id) return 1;
          if (a.id === chain.id) return -1;
          if (b.id === chain.id) return 1;
          return a.name.localeCompare(b.name);
        }),
    [allowedChains, deployedFactories, lifiChains],
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
    (token: undefined | { external: boolean; token: Token }) => {
      if (!token) return 0n;
      const address = parse(Address, token.token.address);
      const tokenChain = token.token.chainId as number;
      if (tokenChain !== chain.id) {
        return crossChainAssets.find((a) => a.chainId === tokenChain && a.address === address)?.amount ?? 0n;
      }
      if (token.external) {
        return externalAssets.find((a) => a.address === address)?.amount ?? 0n;
      }
      return protocolAssets.find((a) => a.asset === address)?.floatingDepositAssets ?? 0n;
    },
    [crossChainAssets, externalAssets, protocolAssets],
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
              ? asset.floatingDepositAssets > 0n && !isExternal(chain.id, asset.asset)
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
  const tabs =
    !restricted && (isLifiLoading || isChainsLoading || isBaseLoading || candidates.some((token) => isStock(token)));
  const stocks = tabs && (mode ? mode === "stocks" : toToken ? isStock(toToken.token) : filter === "stocks");
  useEffect(() => {
    if (stocks) queryClient.setQueryData(["settings", "stocks-tab-seen"], true);
  }, [stocks]);
  const selectableTokens = useMemo(
    () => candidates.filter((token) => tokenSelectionType === "from" || isStock(token) === stocks),
    [candidates, stocks, tokenSelectionType],
  );

  useEffect(() => {
    if (!markets || !homeTokens || (fromToken && toToken)) return;
    updateSwap((old) => {
      const inputs = payableTokens.filter((token) => !sameToken(token, old.toToken?.token));
      const home = inputs.filter((token) => (token.chainId as number) === chain.id);
      const preferred = home.length > 0 ? home : inputs;
      const input = old.fromToken?.token ?? preferred.find(({ symbol }) => symbol === "USDC") ?? preferred[0];
      const target =
        old.toToken?.token ??
        (stocks ? candidates.find((token) => isStock(token) && !sameToken(token, input)) : undefined) ??
        (stocks && (isLifiLoading || isBaseLoading || isChainsLoading)
          ? undefined
          : ((input && isStock(input) ? ["USDC", "EXA", "WETH"] : ["EXA", "WETH", "USDC"])
              .map((symbol) => homeTokens.find((token) => token.symbol === symbol))
              .find((token) => token !== undefined && !sameToken(token, input)) ??
            homeTokens.find((token) => !sameToken(token, input) && !isStock(token))));
      return {
        ...old,
        fromToken:
          old.fromToken ?? (input ? { token: input, external: isExternal(input.chainId, input.address) } : undefined),
        toToken:
          old.toToken ?? (target ? { token: target, external: isExternal(target.chainId, target.address) } : undefined),
      };
    });
  }, [
    candidates,
    fromToken,
    homeTokens,
    isBaseLoading,
    isChainsLoading,
    isExternal,
    isLifiLoading,
    markets,
    payableTokens,
    stocks,
    toToken,
  ]);

  const locked = !fromToken || !toToken || (restricted && isStock(fromToken.token));
  const processing = chain.id === base.id && isKYCInReview;
  const failed = chain.id === base.id && isKYCFailed;

  const unverified = chain.id === base.id && isKYCFetched && isKYCUnverified;

  const unavailable =
    chain.id === base.id && isKYCFetched && (!!kycError || !isKYCApproved) && !processing && !failed && !unverified;

  const balancesUnavailable =
    !!balancesError && !isTokensLoading && fromChain === chain.id && !fromToken && payableTokens.length === 0;
  const chainsUnavailable = !!chainsError && !lifiChains && fromChain !== chain.id;

  const empty =
    !isTokensLoading &&
    !tokensError &&
    !isBalancesPending &&
    !balancesError &&
    !!markets &&
    fromChain === chain.id &&
    !fromToken &&
    payableTokens.length === 0;

  const handleTokenSelect = (selected: Token, external = isExternal(selected.chainId, selected.address)) => {
    updateSwap((old) => ({
      ...old,
      fromAmount: tokenSelectionType === "to" && !sameToken(selected, fromToken?.token) ? fromAmount : 0n,
      toAmount: 0n,
      denied: [],
      fromToken:
        tokenSelectionType === "from"
          ? { token: selected, external }
          : sameToken(selected, fromToken?.token)
            ? toToken
            : fromToken,
      toToken:
        tokenSelectionType === "to"
          ? { token: selected, external }
          : sameToken(selected, toToken?.token)
            ? fromToken && restricted && isStock(fromToken.token)
              ? undefined
              : fromToken
            : toToken,
      mode: tokenSelectionType === "from" && !old.toToken ? old.mode : undefined,
      tokenModalOpen: false,
    }));
  };

  function changeMode(next: "crypto" | "stocks") {
    setAcknowledged(false);
    updateSwap((old) => ({
      ...old,
      mode: next,
      toToken: undefined,
      toAmount: 0n,
      denied: [],
      tokenSelectionType: next === "stocks" ? "to" : old.tokenSelectionType,
      tokenModalOpen: next === "stocks" || old.tokenModalOpen,
    }));
  }

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
    enabled: enableSimulations && !tokenModalOpen && !!account && !!fromToken && !!toToken && !!inputFromAmount,
    refetchInterval: ({ state }) => (state.error && classify(state.error) !== "quote" ? false : 20_000),
    retry: false,
    staleTime: 10_000,
    meta: { dropError: () => true },
  });

  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!routeUpdatedAt) return;
    const timer = setTimeout(
      () => setNow(Math.max(Date.now(), routeUpdatedAt + quoteValidity)),
      routeUpdatedAt + quoteValidity - Date.now(),
    );
    return () => clearTimeout(timer);
  }, [routeUpdatedAt]);
  const quoteExpired = !!route && now >= routeUpdatedAt + quoteValidity;

  const fromAmount = inputFromAmount;
  const toAmount = route?.toAmount ?? inputToAmount;
  const tool = route?.tool ?? "";

  const fromUSD = Number(route?.estimate.fromAmountUSD);
  const toUSD = Number(route?.estimate.toAmountUSD);
  const impact = fromUSD > 0 && toUSD > 0 ? 1 - toUSD / fromUSD : 0;
  const feeds = [useFeed(toToken?.token), useFeed(fromToken?.token)];
  const priced = [toToken, fromToken].find(
    (side, index) => !!side && !feeds.includes(undefined) && !feeds[index]?.stablecoin,
  );

  const isInsufficientBalance = useMemo(() => {
    if (!fromToken) return false;
    return fromAmount > getBalance(fromToken);
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
    delay: proposalDelay,
    isPending: isSimulatingSwap,
    queued,
  } = useSimulateProposal({
    account,
    amount: fromAmount,
    market: getSwapAddress(fromToken),
    proposalType: ProposalType.Swap,
    assetOut: crossChain ? neutralAsset : parse(Address, toToken?.token.address ?? zeroAddress),
    minAmountOut: crossChain ? 0n : (toAmount * (WAD * (1000n - SLIPPAGE_PERCENT))) / 1000n / WAD,
    route: route?.data,
    poll: true,
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
  const undeployed =
    prepareError instanceof BaseError &&
    !!prepareError.walk((cause) => cause instanceof DeploymentError && cause.missing === "account");
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
  const overdrawn =
    !!prepareError && !fromToken?.external && revertReason(prepareError, { withArguments: true }) === "Panic(17)";

  const [verified, setVerified] = useState<typeof prepareError>(null);
  const isSimulating = fromToken?.external
    ? routed
      ? isSimulatingRouted
      : isSimulatingExternalSwap
    : (isSimulatingSwap && !queued) || (overdrawn && verified !== prepareError);

  useEffect(() => {
    if (!overdrawn && !insufficientCollateral) return;
    let current = true;
    queryClient
      .invalidateQueries({ queryKey: marketsQueryKey })
      .then(() => {
        if (current) setVerified(prepareError);
      })
      .catch(reportError);
    return () => {
      current = false;
    };
  }, [insufficientCollateral, overdrawn, prepareError]); // eslint-disable-line @eslint-react/exhaustive-deps -- wagmi query key changes every render
  useEffect(() => {
    if (!prepareError || queued || insufficientCollateral) return;
    if (overdrawn && (verified !== prepareError || isInsufficientBalance)) return;
    reportError(prepareError, { level: "warning" });
    if (!tool || stalled || undeployed) return;
    updateSwap((old) => ({
      ...old,
      denied: old.denied.includes(tool) ? old.denied : [...old.denied, tool].slice(0, 3),
    }));
  }, [
    insufficientCollateral,
    isInsufficientBalance,
    overdrawn,
    prepareError,
    queued,
    stalled,
    tool,
    undeployed,
    verified,
  ]);
  const rerouting = denied.length > 0 && !route && isRouteFetching;
  const transient =
    !!routeError &&
    classify(routeError) === "quote" &&
    (route ? routeErroredAt < routeUpdatedAt + quoteValidity : routeErrors < 3);
  const failure = queued
    ? "queued"
    : routeError && !transient
      ? classify(routeError)
      : prepareError
        ? undeployed
          ? "account"
          : (overdrawn || insufficientCollateral) && isInsufficientBalance
            ? "balance"
            : insufficientCollateral
              ? "collateral"
              : stalled || (tool && denied.length < 3 && !denied.includes(tool))
                ? undefined
                : "route"
        : undefined;

  const nativeToken = lifiChains?.find((item) => item.id === fromChain)?.nativeToken;
  const fromNetworkName = lifiChains?.find((item) => item.id === fromChain)?.name;
  const networkName = lifiChains?.find((item) => item.id === toChain)?.name;
  const sponsored = fromChain === chain.id;
  const networkCost = sponsored ? 0n : nativeToken ? routedSwap?.gas : undefined;
  const networkFeeUSD = sponsored
    ? 0
    : networkCost !== undefined && nativeToken
      ? Number(formatUnits(networkCost, nativeToken.decimals)) * Number(nativeToken.priceUSD)
      : undefined;
  const gasSource = useMemo(
    () => (fromToken?.external ? { ...fromToken.token, amount: getBalance(fromToken) } : null),
    [fromToken, getBalance],
  );
  const {
    erc20GasReserve,
    feeIsSource,
    gasToken,
    insufficientGas,
    nativeBalance,
    nativeGasReserve,
    paymasterAddress,
    sendCalls,
  } = useCrossChainGas({
    account,
    amount: fromAmount,
    chainId: fromChain,
    networkCost,
    token: gasSource,
    value: routed ? (route?.value ?? 0n) : undefined,
  });

  const duration =
    route &&
    (fromToken?.external
      ? route.estimate.executionDuration
      : proposalDelay === undefined
        ? undefined
        : route.estimate.executionDuration + Number(proposalDelay));

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
        duration,
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
    const log = receipt.logs.find(({ topics }) => topics[0] === topic);
    return log?.topics[2]
      ? { manager: log.address, nonce: BigInt(log.topics[2]), since: receipt.blockNumber }
      : undefined;
  }, [receipt]);
  const { data: execution } = useQuery(executionOptions(account, proposal?.manager, proposal?.nonce, proposal?.since));
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
  const caution = projectedHealth !== undefined && projectedHealth < liquidationCaution;
  const danger = projectedHealth !== undefined && projectedHealth < liquidationRisk;

  const routeValue = routed ? (route?.value ?? 0n) : 0n;
  const shortfallFee =
    insufficientGas && nativeToken
      ? routeValue <= (nativeBalance ?? 0n) && gasToken && feeIsSource && paymasterAddress && erc20GasReserve > 0n
        ? { reserve: erc20GasReserve, token: gasToken, network: undefined }
        : {
            reserve: routeValue + nativeGasReserve,
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

  const showWarning = !failure && fromToken && !fromToken.external && fromAmount > 0n && (caution || danger);
  const disabled =
    !route ||
    networkCost === undefined ||
    quoteExpired ||
    isSimulating ||
    rerouting ||
    stalled ||
    !!failure ||
    isInsufficientBalance ||
    insufficientGas;
  const buttonLabel = useMemo(() => {
    if (failure === "account") return t("Contact support");
    if (isInsufficientBalance) return t("Insufficient balance");
    if (insufficientGas) return t("Not enough for network fees");
    if (rerouting || quoteExpired || (isSimulating && route)) return t("Please wait...");
    if (failure) return t("Cannot proceed");
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
                router.dismissTo("/(main)/(home)/defi");
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
                    if (result.status === "complete") router.dismissTo("/(main)/(home)");
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
        ) : balancesUnavailable || chainsUnavailable ? (
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s3" padding="$s4">
            <TriangleAlert size={48} color="$uiNeutralSecondary" />
            <Text emphasized primary headline textAlign="center">
              {t("An error occurred. Please try again later.")}
            </Text>
            <Button
              primary
              marginTop="$s4"
              loading={isBalancesFetching || isChainsFetching}
              disabled={isBalancesFetching || isChainsFetching}
              onPress={() => {
                (balancesUnavailable ? refetchBalances() : refetchChains()).catch(reportError);
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
            {tabs && (
              <Tabs
                items={[
                  { key: "crypto", label: t("Crypto"), Icon: Coins },
                  {
                    key: "stocks",
                    label: t("Stocks"),
                    Icon: ChartNoAxesCombined,
                    badge: !stocksTabSeen && (
                      <Text
                        pill
                        caption2
                        color="$interactiveOnBaseBrandDefault"
                        backgroundColor="$interactiveBaseBrandDefault"
                      >
                        {t("NEW")}
                      </Text>
                    ),
                  },
                ]}
                value={stocks ? "stocks" : "crypto"}
                onChange={changeMode}
              />
            )}
            <ScrollView
              ref={swapsScrollReference}
              showsVerticalScrollIndicator={false}
              keyboardDismissMode="on-drag"
              flex={1}
            >
              <View padded>
                <YStack paddingBottom="$s3" gap="$s4_5">
                  <MarketClosedBanner
                    open={[fromToken, toToken].some((side) => !!side && isStock(side.token)) && !marketOpen()}
                  />
                  <YStack>
                    {(["from", "to"] as const).map((type) => {
                      const paying = type === "from";
                      const tokenData = paying ? fromToken : toToken;
                      return (
                        <React.Fragment key={type}>
                          {!paying && (
                            <XStack paddingTop="$s3_5" justifyContent="center" alignItems="center" zIndex={1}>
                              <XStack
                                position="absolute"
                                width={48}
                                height={48}
                                borderRadius="$r_0"
                                borderWidth={4}
                                borderColor="$backgroundSoft"
                                backgroundColor={locked ? "$interactiveDisabled" : "$interactiveBaseBrandSoftDefault"}
                                justifyContent="center"
                                alignItems="center"
                                cursor={locked ? "not-allowed" : "pointer"}
                                role="button"
                                aria-label={t("Switch tokens")}
                                aria-disabled={locked}
                                disabled={locked}
                                rotate={`${flips * 180}deg`}
                                transition="quick"
                                pressStyle={{ opacity: 0.85, scale: 0.9 }}
                                onPress={() => {
                                  selectionAsync().catch(reportError);
                                  if (debounceRef.current) clearTimeout(debounceRef.current);
                                  setAcknowledged(false);
                                  setFlips((count) => count + 1);
                                  updateSwap((old) => ({
                                    ...old,
                                    fromAmount: 0n,
                                    toAmount: 0n,
                                    denied: [],
                                    fromToken: old.toToken,
                                    toToken: old.fromToken,
                                    mode: undefined,
                                  }));
                                }}
                              >
                                <ArrowDownUp
                                  size={20}
                                  color={locked ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
                                />
                              </XStack>
                            </XStack>
                          )}
                          <TokenInput
                            label={t(paying ? "You pay" : "You receive")}
                            token={tokenData?.token}
                            amount={paying ? fromAmount : toAmount}
                            balance={getBalance(tokenData)}
                            disabled={!paying}
                            isLoading={isTokensLoading || !tokenData || isRouteLoading}
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
                        </React.Fragment>
                      );
                    })}
                  </YStack>
                  {priced && (
                    <PriceSummary
                      key={`${priced.token.chainId}:${priced.token.address}`}
                      token={priced.token}
                      onPress={() => {
                        router.push({
                          pathname: "/asset",
                          params: {
                            chainId: String(priced.token.chainId),
                            address: priced.token.address,
                            market: priced.external
                              ? undefined
                              : markets?.find(({ asset }) => asset === priced.token.address)?.market,
                          },
                        });
                      }}
                    />
                  )}
                  {fromToken && toToken && route && (
                    <SwapDetails
                      exchange={tool}
                      fee={route.estimate.feeCosts?.reduce((sum, { percentage }) => sum + Number(percentage), 0)}
                      slippage={crossChain || routed ? BigInt(bridgeSlippage * 1000) : SLIPPAGE_PERCENT}
                      exchangeRate={getExchangeRate(fromToken.token, toToken.token, fromAmount, toAmount)}
                      fromToken={fromToken.token}
                      toToken={toToken.token}
                      networkFeeUSD={networkFeeUSD}
                      duration={
                        crossChain || !fromToken.external
                          ? (duration ?? (isInsufficientBalance ? undefined : null))
                          : undefined
                      }
                    />
                  )}
                  <Text caption2 color="$interactiveOnDisabled">
                    <Trans
                      i18nKey="Swaps are provided via <provider>LI.FI</provider> on decentralized networks. Some assets may not be available in every country, so please check your local regulations before swapping."
                      components={{
                        provider: (
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
                </YStack>
              </View>
            </ScrollView>
            <YStack padding="$s4" gap="$s3">
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
                  <Text caption2 color={failure || insufficientGas ? "$uiErrorSecondary" : "$uiInfoSecondary"} flex={1}>
                    {failure === "collateral"
                      ? t("This swap would leave your collateral below what your debt requires. Try a smaller amount.")
                      : failure === "route"
                        ? t("No route available for this swap. Try a different asset or network.")
                        : failure === "liquidity"
                          ? t("Not enough liquidity for this amount currently. Try a different amount.")
                          : failure === "account"
                            ? t("Your account isn't set up on this network yet. Contact support to fix it.")
                            : failure === "queued"
                              ? t("You have a pending request. Wait for it to be processed before swapping again.")
                              : failure === "balance"
                                ? t("Your balance changed. Check the amount and try again.")
                                : failure
                                  ? t("We can’t get a quote right now. Try again in a moment.")
                                  : (shortfall ?? (rerouting ? t("Trying another route...") : t("Retrying quote...")))}
                  </Text>
                </XStack>
              )}
              {impact >= 0.02 && (
                <XStack gap="$s3" alignItems="center">
                  <TriangleAlert size={16} color="$uiWarningSecondary" />
                  <Text caption color="$uiWarningSecondary" flex={1}>
                    {t("High price impact: you receive {{percent}}% less value than you pay.", {
                      percent: (impact * 100).toFixed(1),
                    })}
                  </Text>
                </XStack>
              )}
              {showWarning && (
                <YStack gap="$s4_5">
                  <Separator borderColor={danger ? "$borderErrorStrong" : "$borderNeutralSoft"} />
                  <YStack gap="$s3_5">
                    {danger ? (
                      <XStack gap="$s3" alignItems="flex-start">
                        <TriangleAlert size={16} color="$uiErrorSecondary" />
                        <Text caption color="$uiErrorSecondary" flex={1}>
                          {t("Swapping this much of your collateral could instantly trigger liquidation.")}
                        </Text>
                      </XStack>
                    ) : null}
                    <XStack
                      gap="$s3"
                      alignItems="center"
                      cursor="pointer"
                      onPress={() => {
                        setAcknowledged(!acknowledged);
                      }}
                    >
                      <Checkbox danger={danger} checked={acknowledged}>
                        <Checkbox.Indicator>
                          <Check
                            size={16}
                            color={danger ? "$interactiveOnBaseErrorDefault" : "$interactiveOnBaseBrandDefault"}
                          />
                        </Checkbox.Indicator>
                      </Checkbox>
                      <Text caption color={danger ? "$uiErrorSecondary" : "$uiNeutralSecondary"} flex={1}>
                        {t("I acknowledge the risks of swapping this much of my collateral assets.")}
                      </Text>
                    </XStack>
                  </YStack>
                  <Separator borderColor="$borderNeutralSoft" />
                </YStack>
              )}
              <Button
                primary={!(caution && acknowledged)}
                dangerSecondary={caution && acknowledged}
                disabled={failure !== "account" && (disabled || (caution && !acknowledged))}
                loading={isSimulating && !!route && !isInsufficientBalance}
                width="100%"
                onPress={() => {
                  if (failure === "account") {
                    if (account) requestDeployment(t, account, fromChain).catch(reportError);
                    return;
                  }
                  swap();
                }}
              >
                <Button.Text>{buttonLabel}</Button.Text>
                <Button.Icon>
                  {failure === "account" ? <Headphones /> : danger ? <TriangleAlert /> : <Repeat />}
                </Button.Icon>
              </Button>
            </YStack>
            <TokenSelectModal
              key={tokenSelectionType}
              withBalanceOnly={tokenSelectionType === "from"}
              open={tokenModalOpen}
              tokens={selectableTokens}
              networks={tokenSelectionType === "to" && stocks ? undefined : networks}
              onStocks={
                tokenSelectionType === "to" && tabs && !stocks
                  ? () => {
                      changeMode("stocks");
                    }
                  : undefined
              }
              selected={tokenSelectionType === "from" ? fromToken : toToken}
              onSelect={handleTokenSelect}
              onClose={() => updateSwap((old) => ({ ...old, tokenModalOpen: false }))}
              isLoading={isTokensLoading || (tokenSelectionType === "to" && !toToken)}
              title={
                tokenSelectionType === "from"
                  ? t("Select token to pay")
                  : stocks
                    ? t("Select stock to receive")
                    : t("Select token to receive")
              }
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
      fromUsdAmount: Number(formatUnits((resultFromAmount * parseAmount(paid.priceUSD, 18)) / WAD, paid.decimals)),
      fromAmount: resultFromAmount,
      fromToken: paid,
      toUsdAmount: Number(formatUnits((resultToAmount * parseAmount(received.priceUSD, 18)) / WAD, received.decimals)),
      toAmount: resultToAmount,
      toToken: received,
    };
    if (isSwapping || (isSwapSuccess && !delivered && !undelivered))
      return (
        <Pending
          {...properties}
          network={crossChain ? networkName : undefined}
          duration={resultRef.current.duration}
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
    router.dismissTo("/(main)/(home)");
  }
}

export function sameToken(token: Token, other?: Token) {
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
