import React, { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet } from "react-native";
import { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { impactAsync, ImpactFeedbackStyle, notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, CircleHelp, Info, OctagonX, TriangleAlert, X } from "@tamagui/lucide-icons";
import { AnimatePresence, ScrollView, Separator, Square, XStack, YStack } from "tamagui";

import { getAlchemyPaymasterAddress } from "@account-kit/infra";
import { useMutation, useQuery } from "@tanstack/react-query";
import { readContract, waitForCallsStatus } from "@wagmi/core/actions";
import { parse, safeParse } from "valibot";
import {
  encodeEventTopics,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  maxUint256,
  zeroAddress as viemZeroAddress,
} from "viem";
import { useEstimateFeesPerGas, useEstimateGas, useReadContract, useSendCalls, useSimulateContract } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, { exaPluginAddress } from "@exactly/common/generated/chain";
import {
  proposalManagerAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import { Address, type Credential } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import alchemyChainById from "../../utils/alchemyChains";
import executionOptions from "../../utils/executionOptions";
import { presentArticle } from "../../utils/intercom";
import {
  balancesOptions,
  bridgePolicyId,
  bridgePolicySymbols,
  gasReserveBuffer,
  getRouteFrom,
  lifiChainsOptions,
  lifiTokensOptions,
  nativeFeeRoute,
  quoteValidity,
  statusOptions,
} from "../../utils/lifi";
import parseAmount from "../../utils/parseAmount";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useSimulateProposal from "../../utils/useSimulateProposal";
import exa from "../../utils/wagmi/exa";
import AnimatedView from "../shared/AnimatedView";
import AssetLogo from "../shared/AssetLogo";
import Blocky from "../shared/Blocky";
import GradientScrollView from "../shared/GradientScrollView";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import ExaSpinner from "../shared/Spinner";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

import type { ExtendedTransactionInfo, StatusResponse } from "@lifi/sdk";
import type { TFunction } from "i18next";

export default function Confirm() {
  const router = useRouter();
  const { address } = useAccount();
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const {
    asset: assetParameter,
    fromChain,
    toChain,
    toToken,
    amount,
    fromAmount: fromAmountParameter,
    receiver: receiverParameter,
  } = useLocalSearchParams();
  const payParse = safeParse(Address, assetParameter);
  const pay = payParse.success ? payParse.output : undefined;
  const zeroAddress = parse(Address, viemZeroAddress);
  const receiver = typeof receiverParameter === "string" ? receiverParameter : "";
  const receiverParse = safeParse(Address, receiverParameter);
  const receiverHex = receiverParse.success ? receiverParse.output : undefined;
  const payChain = typeof fromChain === "string" ? Number(fromChain) : chain.id;
  const destinationChain = typeof toChain === "string" ? Number(toChain) : chain.id;
  const destinationAmount = typeof amount === "string" && /^\d+$/.test(amount) ? BigInt(amount) : 0n;

  const { market: homeMarket, externalAsset: homeExternal, markets } = useAsset(pay);
  const { data: balances } = useQuery(balancesOptions(address));
  const market = payChain === chain.id ? homeMarket : undefined;
  const external =
    payChain === chain.id
      ? homeExternal
      : (balances?.[payChain]?.find((token) => token.address.toLowerCase() === pay?.toLowerCase()) ?? null);
  const paySymbol = market ? (market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3)) : external?.symbol;
  const payDecimals = market?.decimals ?? external?.decimals ?? 18;
  const payPrice = market ? market.usdPrice : parseAmount(external?.priceUSD, 18);
  const payUnderlying = market?.asset ?? external?.address;

  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: tokens, isFetching: isTokensFetching, refetch: refetchTokens } = useQuery(lifiTokensOptions);
  const networkName = chains?.find((item) => item.id === destinationChain)?.name ?? chain.name;
  const destination = useMemo(() => {
    if (typeof toToken !== "string") return;
    const token = tokens?.find(
      (item) =>
        item.chainId === (destinationChain as typeof item.chainId) &&
        item.address.toLowerCase() === toToken.toLowerCase(),
    );
    if (token) {
      return {
        address: token.address,
        decimals: token.decimals,
        logoURI: token.logoURI,
        price: parseAmount(token.priceUSD, 18),
        symbol: token.symbol,
      };
    }
    if (
      destinationChain === payChain &&
      payUnderlying &&
      paySymbol &&
      toToken.toLowerCase() === payUnderlying.toLowerCase()
    ) {
      return {
        address: payUnderlying,
        decimals: payDecimals,
        logoURI: external?.logoURI,
        price: payPrice,
        symbol: paySymbol,
      };
    }
  }, [toToken, tokens, destinationChain, payChain, payUnderlying, paySymbol, payDecimals, payPrice, external?.logoURI]);

  const destinationAddress = destination?.address;
  const routed =
    destinationChain !== payChain ||
    (typeof toToken === "string" && toToken.toLowerCase() !== payUnderlying?.toLowerCase());

  const fromAmount =
    typeof fromAmountParameter === "string" && /^\d+$/.test(fromAmountParameter)
      ? BigInt(fromAmountParameter)
      : routed
        ? 0n
        : destinationAmount;

  const [confirmed, setConfirmed] = useState<bigint>();
  const [denied, setDenied] = useState<string[]>([]);

  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!address && !!credential },
  });
  const queued = !!market && installedPlugins?.[0] === exaPluginAddress;

  const {
    request: proposeSimulation,
    error: proposeError,
    isPending: isProposePending,
  } = useSimulateProposal({
    account: address,
    amount: fromAmount,
    market: market?.market,
    proposalType: ProposalType.Withdraw,
    receiver: receiverHex,
    enabled: !routed && !!market && !!address && fromAmount > 0n && !!receiverHex && receiverHex !== zeroAddress,
  });

  const {
    data: route,
    dataUpdatedAt: routeUpdatedAt,
    error: routeError,
    errorUpdatedAt: routeErroredAt,
    errorUpdateCount: routeErrors,
    isFetching: isRouteFetching,
    refetch: refetchRoute,
  } = useQuery({
    queryKey: [
      "lifi",
      "route",
      "send",
      address,
      payChain,
      payUnderlying,
      destinationChain,
      destinationAddress,
      receiver,
      denied,
      String(fromAmount),
      !!market,
    ],
    queryFn: () => {
      if (!address || !payUnderlying || !destinationAddress) throw new Error("missing route parameters");
      return getRouteFrom({
        fromChainId: payChain,
        toChainId: destinationChain,
        fromTokenAddress: payUnderlying,
        toTokenAddress: destinationAddress,
        fromAmount,
        fromAddress: address,
        toAddress: receiver,
        denyBridges: destinationChain === payChain ? undefined : denied,
        denyExchanges:
          destinationChain === payChain ? Object.fromEntries(denied.map((tool) => [tool, true])) : undefined,
        nativeless: !!market,
      }).catch((error: unknown) => {
        reportError(error, {
          level: "warning",
          extra: { lifi: (error as { cause?: { responseBody?: unknown } }).cause?.responseBody },
        });
        throw error;
      });
    },
    enabled:
      routed &&
      confirmed === undefined &&
      !!address &&
      !!payUnderlying &&
      !!destinationAddress &&
      fromAmount > 0n &&
      !!receiver,
    refetchInterval: ({ state }) => (state.error && classify(state.error) !== "quote" ? false : quoteValidity / 3),
    retry: false,
    meta: { dropError: () => true },
  });
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!routeUpdatedAt || confirmed !== undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [routeUpdatedAt, confirmed]);
  const quoteSeconds = route
    ? Math.max(0, Math.ceil((routeUpdatedAt + quoteValidity / 3 - (now || routeUpdatedAt)) / 1000))
    : undefined;
  const quoteExpired = !!route && now >= routeUpdatedAt + quoteValidity;

  const neutralAsset = useMemo(() => {
    const { success, output } = safeParse(
      Address,
      markets?.find(({ asset }) => asset.toLowerCase() !== payUnderlying?.toLowerCase())?.asset,
    );
    return success ? output : undefined;
  }, [markets, payUnderlying]);

  const { request: bridgePropose, error: bridgeProposeError } = useSimulateProposal({
    account: address,
    amount: fromAmount,
    market: market?.market,
    proposalType: ProposalType.Swap,
    assetOut: neutralAsset,
    minAmountOut: 0n,
    route: route?.data,
    enabled: routed && !!market && !!address && !!route && !!neutralAsset && fromAmount > 0n,
  });

  const externalAddress = useMemo(() => {
    const { success, output } = safeParse(Address, external?.address);
    return success ? output : zeroAddress;
  }, [external?.address, zeroAddress]);

  const isNativeTransfer = !!external && externalAddress === zeroAddress;

  const {
    data: erc20TransferSimulation,
    error: erc20TransferError,
    isFetching: isErc20TransferSimulating,
    refetch: refetchErc20Transfer,
  } = useSimulateContract({
    address: externalAddress,
    chainId: payChain,
    abi: erc20Abi,
    functionName: "transfer",
    args: receiverHex ? [receiverHex, fromAmount] : undefined,
    query: {
      enabled:
        !routed &&
        !!external &&
        !isNativeTransfer &&
        !!address &&
        fromAmount > 0n &&
        !!receiverHex &&
        receiverHex !== zeroAddress,
    },
  });

  const {
    data: transferEstimate,
    error: transferEstimateError,
    isFetching: isTransferEstimating,
    refetch: refetchTransferEstimate,
  } = useEstimateGas({
    chainId: payChain,
    to: isNativeTransfer ? receiverHex : externalAddress,
    value: isNativeTransfer ? fromAmount : undefined,
    data:
      isNativeTransfer || !receiverHex
        ? undefined
        : encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [receiverHex, fromAmount] }),
    query: {
      enabled: !routed && !!external && !!address && fromAmount > 0n && !!receiverHex && receiverHex !== zeroAddress,
    },
  });

  const { data: fees } = useEstimateFeesPerGas({
    chainId: payChain,
    query: { enabled: payChain !== chain.id && !!external && !routed },
  });

  const payNetwork = chains?.find((item) => item.id === payChain);
  const nativeToken = payNetwork?.nativeToken;
  const sponsored = payChain === chain.id;
  const networkCost = useMemo(() => {
    if (sponsored) return 0n;
    if (!nativeToken) return;
    if (routed) {
      return route
        ? (route.estimate.gasCosts ?? [])
            .filter(({ token }) => token.address.toLowerCase() === nativeToken.address.toLowerCase())
            .reduce((sum, gas) => sum + BigInt(gas.amount), 0n)
        : undefined;
    }
    return fees?.maxFeePerGas && transferEstimate ? transferEstimate * fees.maxFeePerGas : undefined;
  }, [fees?.maxFeePerGas, nativeToken, route, routed, sponsored, transferEstimate]);
  const networkFeeUSD = sponsored
    ? 0
    : routed
      ? route
        ? (route.estimate.gasCosts ?? []).reduce((sum, { amountUSD }) => sum + (Number(amountUSD) || 0), 0)
        : undefined
      : networkCost !== undefined && nativeToken
        ? Number(formatUnits(networkCost, nativeToken.decimals)) * Number(nativeToken.priceUSD)
        : undefined;
  const nativeGasReserve = networkCost === undefined ? 0n : (networkCost * gasReserveBuffer) / 100n;
  const nativeCovered =
    networkCost !== undefined &&
    (isNativeTransfer ? fromAmount + nativeGasReserve : nativeGasReserve) <=
      (balances?.[payChain]?.find(({ address: token }) => token.toLowerCase() === nativeToken?.address.toLowerCase())
        ?.amount ?? 0n);
  const gasToken = useMemo(() => {
    if (sponsored || isNativeTransfer || !external) return;
    if (bridgePolicySymbols.has(external.symbol)) return external;
    return balances?.[payChain]?.find(
      (item) =>
        item.address.toLowerCase() !== nativeToken?.address.toLowerCase() &&
        bridgePolicySymbols.has(item.symbol) &&
        !!item.amount &&
        item.amount > 0n,
    );
  }, [balances, external, isNativeTransfer, nativeToken?.address, payChain, sponsored]);
  const paymasterChain = alchemyChainById.get(payChain);
  const paymasterAddress = paymasterChain ? getAlchemyPaymasterAddress(paymasterChain, "0.6.0") : undefined;
  const erc20GasReserve = useMemo(() => {
    if (nativeGasReserve === 0n || !nativeToken || !gasToken) return 0n;
    const nativeUsd = parseAmount(nativeToken.priceUSD, 18);
    const tokenUsd = parseAmount(gasToken.priceUSD, 18);
    if (nativeUsd <= 0n || tokenUsd <= 0n) return 0n;
    return (
      (nativeGasReserve * nativeUsd * 10n ** BigInt(gasToken.decimals)) /
      (tokenUsd * 10n ** BigInt(nativeToken.decimals))
    );
  }, [gasToken, nativeGasReserve, nativeToken]);
  const feeIsSource = !!gasToken && gasToken.address.toLowerCase() === externalAddress.toLowerCase();
  const paymasterFee =
    !nativeCovered &&
    gasToken &&
    paymasterAddress &&
    erc20GasReserve > 0n &&
    (feeIsSource ? fromAmount + erc20GasReserve : erc20GasReserve) <= (gasToken.amount ?? 0n)
      ? gasToken
      : undefined;
  const insufficientGas =
    nativeGasReserve > 0n && !nativeCovered && !paymasterFee && (isNativeTransfer || feeIsSource || !paymasterAddress);

  const { refetch: refetchPaymasterAllowance } = useReadContract({
    address: paymasterFee ? getAddress(paymasterFee.address) : undefined,
    chainId: payChain,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && paymasterAddress ? [address, paymasterAddress] : undefined,
    query: { enabled: !!paymasterFee && !!address && !!paymasterAddress, staleTime: 0 },
  });

  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const sendCalls = async (calls: readonly { data?: `0x${string}`; to: `0x${string}`; value?: bigint }[]) => {
    const paymaster =
      paymasterFee && paymasterAddress
        ? { token: getAddress(paymasterFee.address), address: paymasterAddress }
        : undefined;
    const { data: allowance } = paymaster ? await refetchPaymasterAllowance() : { data: undefined };
    const approval =
      paymaster && (allowance ?? 0n) < erc20GasReserve
        ? [
            {
              to: paymaster.token,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [paymaster.address, maxUint256],
              }),
            },
          ]
        : [];
    const url = `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`;
    let id: string;
    try {
      ({ id } = await mutateSendCalls({
        chainId: payChain,
        calls: [...approval, ...calls],
        ...(sponsored
          ? { capabilities: { paymasterService: { url, context: { policyId: alchemyGasPolicyId } } } }
          : paymaster
            ? {
                capabilities: {
                  paymasterService: {
                    optional: true,
                    url,
                    context: {
                      policyId: bridgePolicyId,
                      erc20Context: { tokenAddress: paymaster.token, maxTokenAmount: erc20GasReserve },
                    },
                  },
                },
              }
            : nativeCovered
              ? {}
              : {
                  capabilities: {
                    paymasterService: { optional: true, url, context: { policyId: alchemyGasPolicyId } },
                  },
                }),
      }));
    } catch (error) {
      if (!paymaster || reportError(error, { level: "warning" }).authKnown) throw error;
      ({ id } = await mutateSendCalls({
        chainId: payChain,
        calls,
        capabilities: { paymasterService: { optional: true, url, context: { policyId: alchemyGasPolicyId } } },
      }));
    }
    const result = await waitForCallsStatus(exa, { id });
    if (result.status === "failure") throw new Error("failed to send");
    return result.receipts?.[0];
  };
  const {
    mutate: send,
    data: receipt,
    isPending: pending,
    isSuccess: success,
    isError: sendError,
    reset,
  } = useMutation({
    async mutationFn() {
      if (!sendReady || !receiver) throw new Error("not ready");
      if (routed) {
        if (!route || !payUnderlying) throw new Error("no route ready");
        setConfirmed(route.toAmount);
        if (bridgePropose) {
          const { address: to, abi, functionName, args } = bridgePropose;
          return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
        }
        const spender = getAddress(route.estimate.approvalAddress);
        const required = BigInt(route.estimate.fromAmount);
        const allowance = isNativeTransfer
          ? required
          : address
            ? await readContract(exa, {
                address: getAddress(payUnderlying),
                chainId: payChain,
                abi: erc20Abi,
                functionName: "allowance",
                args: [address, spender],
              })
            : 0n;
        return sendCalls([
          ...(allowance >= required ? [] : allowance > 0n ? [0n, required] : [required]).map((value) => ({
            to: getAddress(payUnderlying),
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, value] }),
          })),
          { to: route.to, data: route.data, value: route.value },
        ]);
      }
      if (proposeSimulation) {
        const { address: to, abi, functionName, args } = proposeSimulation;
        return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
      }
      if (isNativeTransfer && receiverHex) return sendCalls([{ to: receiverHex, value: fromAmount }]);
      if (erc20TransferSimulation) {
        const { address: to, abi, functionName, args } = erc20TransferSimulation.request;
        return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
      }
      throw new Error("no simulation ready");
    },
    onError(error) {
      if (reportError(error).authKnown) retry();
    },
  });

  function retry() {
    setConfirmed(undefined);
    reset();
  }

  function held() {
    notificationAsync(NotificationFeedbackType.Success).catch(reportError);
    send();
  }

  const web = Platform.OS === "web";
  const hold = useSharedValue(0);
  /* istanbul ignore next */
  const fillStyle = useAnimatedStyle(() => ({ width: `${hold.value * 100}%` }));

  const sendReady = useMemo(() => {
    if (fromAmount <= 0n || !destination || insufficientGas || quoteExpired) return false;
    if (routed) return !!route && (market ? !!bridgePropose : !!payUnderlying);
    return market
      ? !!proposeSimulation
      : !!external && (isNativeTransfer ? !!transferEstimate : !!erc20TransferSimulation);
  }, [
    bridgePropose,
    destination,
    external,
    fromAmount,
    insufficientGas,
    isNativeTransfer,
    market,
    payUnderlying,
    proposeSimulation,
    quoteExpired,
    route,
    routed,
    erc20TransferSimulation,
    transferEstimate,
  ]);

  const hash = receipt?.transactionHash;
  const proposal = useMemo(() => {
    if (!receipt) return;
    const [topic] = encodeEventTopics({ abi: proposalManagerAbi, eventName: "Proposed" });
    const nonce = receipt.logs.find(({ topics }) => topics[0] === topic)?.topics[2];
    return nonce ? { nonce: BigInt(nonce), since: receipt.blockNumber } : undefined;
  }, [receipt]);
  const { data: executionHash } = useQuery(executionOptions(address, proposal?.nonce, proposal?.since));
  const { data: routeStatus } = useQuery(
    statusOptions(
      routed ? (proposal ? (executionHash ?? undefined) : hash) : undefined,
      destinationChain,
      route?.tool,
      payChain,
    ),
  );
  const processing = queued && !(routed && routeStatus?.status === "DONE");
  const exit = market ? "/activity" : "/";

  const { data: recentContacts } = useQuery<undefined | { address: Address; date?: number; ens: string }[]>({
    queryKey: ["contacts", "recent"],
  });

  useEffect(() => {
    if (success && receiverHex && !recentContacts?.some((contact) => contact.address === receiverHex)) {
      queryClient.setQueryData<undefined | { address: Address; date?: number; ens: string }[]>(
        ["contacts", "recent"],
        (old) => [{ address: receiverHex, ens: "", date: Date.now() }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [success, receiverHex, recentContacts]);

  const received = useMemo(() => {
    const settled =
      routeStatus && "receiving" in routeStatus ? (routeStatus.receiving as ExtendedTransactionInfo) : undefined;
    if (settled?.amount) {
      return {
        amount: BigInt(settled.amount),
        decimals: settled.token?.decimals ?? destination?.decimals ?? 18,
        logoURI: settled.token?.logoURI ?? destination?.logoURI,
        price: settled.token?.priceUSD ? parseAmount(settled.token.priceUSD, 18) : (destination?.price ?? 0n),
        symbol: settled.token?.symbol ?? destination?.symbol,
      };
    }
    const quoted = routed ? (confirmed ?? route?.toAmount) : destinationAmount;
    return destination && quoted !== undefined ? { ...destination, amount: quoted } : undefined;
  }, [routeStatus, routed, confirmed, route?.toAmount, destination, destinationAmount]);
  const receivedTokens = received ? Number(formatUnits(received.amount, received.decimals)) : 0;
  const receivedUSD = received ? Number(formatUnits((received.amount * received.price) / WAD, received.decimals)) : 0;

  const totalAmount = route ? BigInt(route.estimate.fromAmount) : fromAmount;
  const totalTokens = Number(formatUnits(totalAmount, payDecimals));
  const feePercent = useMemo(() => {
    if (!route || !destination) return;
    const sent =
      Number(formatUnits((BigInt(route.estimate.fromAmount) * payPrice) / WAD, payDecimals)) ||
      Number(route.estimate.fromAmountUSD);
    const settled =
      Number(formatUnits((route.toAmount * destination.price) / WAD, destination.decimals)) ||
      Number(route.estimate.toAmountUSD);
    if (sent <= 0 || settled <= 0) return;
    return Math.max(0, ((sent - settled) / sent) * 100);
  }, [route, destination, payDecimals, payPrice]);
  const arrivalMinutes = routed ? Math.max(1, Math.ceil((route?.estimate.executionDuration ?? 60) / 60)) : 1;
  const destinationFailure = routed && !destination && !isTokensFetching;
  const transient =
    !!routeError &&
    classify(routeError) === "quote" &&
    (route ? routeErroredAt < routeUpdatedAt + quoteValidity : routeErrors < 3);
  const prepareError = routed
    ? bridgeProposeError
    : market
      ? proposeError
      : (erc20TransferError ?? transferEstimateError);
  const tool = route?.tool;
  const { data: dust } = useReadContract({
    address: route?.wrapped && payUnderlying ? getAddress(payUnderlying) : undefined,
    chainId: payChain,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: route ? [route.to] : undefined,
    query: { enabled: !!route?.wrapped, refetchInterval: quoteValidity / 3 },
  });
  const stalled = !!prepareError && !!route?.wrapped && !!dust && dust > 0n;
  useEffect(() => {
    if (!prepareError) return;
    reportError(prepareError, { level: "warning" });
    if (!routed || !tool || stalled) return;
    setDenied((current) => (current.includes(tool) ? current : [...current, tool].slice(0, 3))); // eslint-disable-line @eslint-react/set-state-in-effect
  }, [prepareError, routed, stalled, tool]);
  const rerouting = denied.length > 0 && !route && isRouteFetching;
  const failure =
    routeError && !transient
      ? classify(routeError)
      : prepareError
        ? stalled
          ? undefined
          : routed && tool
            ? denied.length < 3 && !denied.includes(tool)
              ? undefined
              : "route"
            : "prepare"
        : destinationFailure
          ? "quote"
          : undefined;
  const highFee = feePercent !== undefined && feePercent > 3;
  const fee =
    insufficientGas && nativeToken
      ? feeIsSource && paymasterAddress && erc20GasReserve > 0n
        ? { reserve: erc20GasReserve, token: gasToken, network: undefined }
        : { reserve: nativeGasReserve, token: nativeToken, network: payNetwork.name }
      : undefined;
  const shortfall = fee
    ? t(
        fee.network
          ? "You need ~{{amount}} {{symbol}} on {{network}} for network fees."
          : "Keep ~{{amount}} {{symbol}} for network fees.",
        {
          amount: Number(formatUnits(fee.reserve, fee.token.decimals)).toLocaleString(language, {
            minimumFractionDigits: 0,
            maximumFractionDigits: fee.token.decimals,
            useGrouping: false,
          }),
          symbol: fee.token.symbol,
          network: fee.network,
        },
      )
    : undefined;

  const invalidReceiver = !receiver || receiverHex === zeroAddress;
  if (invalidReceiver || !pay) {
    return (
      <SafeView fullScreen>
        <View gap="$s5" fullScreen padded justifyContent="center" alignItems="center">
          <Text body primary color="$uiNeutralPrimary">
            {invalidReceiver ? t("Invalid receiver address") : t("Invalid asset address")}
          </Text>
          <Button
            dangerSecondary
            alignSelf="center"
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds/asset");
            }}
          >
            <Button.Text>{t("Go back")}</Button.Text>
            <Button.Icon>
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Button.Icon>
          </Button>
        </View>
      </SafeView>
    );
  }

  if (!pending && !sendError && !success) {
    return (
      <SafeView fullScreen>
        <View gap="$s4_5" fullScreen padded>
          <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/send-funds/asset");
              }}
            />
            {!failure && (
              <Text emphasized subHeadline primary>
                {t("Review and send")}
              </Text>
            )}
            <IconButton
              icon={CircleHelp}
              aria-label={t("Help")}
              onPress={() => {
                presentArticle("8950801").catch(reportError);
              }}
            />
          </XStack>
          <YStack flex={1} position="relative" gap="$s4">
            <ScrollView flex={1} showsVerticalScrollIndicator={false}>
              <YStack gap="$s4">
                <YStack gap="$s3_5" alignItems="center" paddingVertical="$s4_5">
                  {received ? (
                    <>
                      <XStack gap="$s3" alignItems="center">
                        <AssetLogo
                          uri={received.logoURI}
                          symbol={received.symbol}
                          width={32}
                          height={32}
                          chainId={destinationChain}
                          network
                        />
                        <Text largeTitle primary numberOfLines={1} adjustsFontSizeToFit>
                          {`${receivedTokens.toLocaleString(language, { maximumFractionDigits: 8 })} ${received.symbol}`}
                        </Text>
                      </XStack>
                      <Text title3 secondary>
                        {`$${receivedUSD.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </Text>
                    </>
                  ) : (
                    <Skeleton width={220} height={47} />
                  )}
                </YStack>
                <YStack gap="$s4">
                  <Separator borderColor="$borderNeutralSoft" />
                  <XStack gap="$s3_5" alignItems="center">
                    <Text footnote secondary flex={1}>
                      {t("To")}
                    </Text>
                    <XStack gap="$s3" alignItems="center">
                      <View borderRadius="$r_0" overflow="hidden">
                        <Blocky seed={receiver} scale={3} />
                      </View>
                      <Text title2 primary mono>
                        {shortenHex(receiver, 4, 6)}
                      </Text>
                    </XStack>
                  </XStack>
                  <Separator borderColor="$borderNeutralSoft" />
                  <YStack gap="$s3_5">
                    <Detail label={t("Network fees")}>
                      {sponsored ? (
                        <Text subHeadline color="$uiSuccessSecondary">
                          {t("Free")}
                        </Text>
                      ) : networkFeeUSD === undefined ? (
                        <Skeleton width={60} height={21} />
                      ) : (
                        <Text subHeadline primary>
                          {`$${networkFeeUSD.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </Text>
                      )}
                    </Detail>
                    {routed && (
                      <>
                        <Detail label={t("Swap via")} info>
                          {route ? (
                            <Text subHeadline primary>
                              {route.tool}
                            </Text>
                          ) : (
                            <Skeleton width={60} height={21} />
                          )}
                        </Detail>
                        <Detail label={t("Swap fee")}>
                          {feePercent === undefined ? (
                            <Skeleton width={60} height={21} />
                          ) : (
                            <Text subHeadline color={highFee ? "$uiWarningSecondary" : "$uiNeutralPrimary"}>
                              {`${feePercent.toLocaleString(language, { maximumFractionDigits: 2 })}%`}
                            </Text>
                          )}
                        </Detail>
                        <Detail label={t("Quote refreshes in")}>
                          {quoteSeconds === undefined ? (
                            <Skeleton width={60} height={21} />
                          ) : (
                            <Text subHeadline color={quoteExpired ? "$uiErrorSecondary" : "$uiNeutralPrimary"}>
                              {`${Math.floor(quoteSeconds / 60)}:${String(quoteSeconds % 60).padStart(2, "0")}`}
                            </Text>
                          )}
                        </Detail>
                        <Detail label={t("Minimum received")} info>
                          {route?.estimate.toAmountMin && received ? (
                            <Text subHeadline primary>
                              {`${Number(formatUnits(BigInt(route.estimate.toAmountMin), received.decimals)).toLocaleString(language, { maximumFractionDigits: 8 })} ${received.symbol}`}
                            </Text>
                          ) : (
                            <Skeleton width={60} height={21} />
                          )}
                        </Detail>
                      </>
                    )}
                    <Detail label={t("Estimated arrival")} info>
                      <Text subHeadline primary>
                        {t("~{{minutes}} min", { minutes: arrivalMinutes })}
                      </Text>
                    </Detail>
                  </YStack>
                  {routed && (
                    <>
                      <Separator borderColor="$borderNeutralSoft" />
                      <XStack gap="$s3_5" alignItems="flex-start">
                        <Text footnote secondary flex={1}>
                          {t("Total")}
                        </Text>
                        {route ? (
                          <YStack gap="$s2" alignItems="flex-end">
                            <XStack gap="$s3" alignItems="center">
                              <AssetLogo
                                uri={external?.logoURI}
                                symbol={paySymbol}
                                width={24}
                                height={24}
                                chainId={payChain}
                                network
                              />
                              <Text title2 primary>
                                {`${totalTokens.toLocaleString(language, { maximumFractionDigits: 8 })} ${paySymbol}`}
                              </Text>
                            </XStack>
                            <Text subHeadline secondary>
                              {`$${Number(formatUnits((totalAmount * payPrice) / WAD, payDecimals)).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            </Text>
                          </YStack>
                        ) : (
                          <Skeleton width={140} height={30} />
                        )}
                      </XStack>
                    </>
                  )}
                </YStack>
              </YStack>
            </ScrollView>
            <YStack gap="$s4">
              {shortfall ? (
                <XStack
                  gap="$s4"
                  alignItems="center"
                  backgroundColor="$interactiveBaseErrorSoftDefault"
                  borderRadius="$r3"
                  paddingHorizontal="$s4"
                  paddingVertical="$s3"
                >
                  <TriangleAlert size={16} color="$uiErrorSecondary" />
                  <Text caption2 color="$uiErrorSecondary" flex={1}>
                    {shortfall}
                  </Text>
                </XStack>
              ) : highFee && !transient ? (
                <XStack
                  gap="$s4"
                  alignItems="center"
                  backgroundColor="$interactiveBaseWarningSoftDefault"
                  borderRadius="$r3"
                  paddingHorizontal="$s4"
                  paddingVertical="$s3"
                >
                  <TriangleAlert size={16} color="$uiWarningSecondary" />
                  <Text caption2 color="$uiWarningSecondary" flex={1}>
                    {t("High swap fee of {{percent}}%. Proceed with caution.", {
                      percent: feePercent.toLocaleString(language, { maximumFractionDigits: 2 }),
                    })}
                  </Text>
                </XStack>
              ) : (
                <XStack
                  gap="$s4"
                  alignItems="center"
                  backgroundColor="$interactiveBaseInformationSoftDefault"
                  borderRadius="$r3"
                  paddingHorizontal="$s4"
                  paddingVertical="$s3"
                >
                  <Info size={16} color="$uiInfoSecondary" />
                  <Text caption2 color="$uiInfoSecondary" flex={1}>
                    {stalled
                      ? t("This route is temporarily unavailable. Retrying automatically...")
                      : rerouting
                        ? t("Trying another route...")
                        : transient
                          ? t("Retrying quote...")
                          : t("Make sure the recipient's address supports {{network}} network.", {
                              network: networkName,
                            })}
                  </Text>
                </XStack>
              )}
              <Button
                primary
                disabled={!sendReady || !!failure || !!shortfall}
                loading={
                  routed
                    ? !route && (isRouteFetching || (!destination && isTokensFetching))
                    : market
                      ? !proposeSimulation && !proposeError && isProposePending
                      : isErc20TransferSimulating || isTransferEstimating
                }
                overflow="hidden"
                {...(web
                  ? {
                      onPress: () => {
                        send();
                      },
                    }
                  : {
                      onPressIn: () => {
                        impactAsync(ImpactFeedbackStyle.Light).catch(reportError);
                        /* istanbul ignore next */
                        hold.value = withSequence(
                          withTiming(1, { duration: 1500, easing: Easing.linear }),
                          withTiming(1, { duration: 120 }, (finished) => {
                            if (finished) scheduleOnRN(held);
                          }),
                        );
                      },
                      onPressOut: () => {
                        if (hold.value < 1) hold.value = withTiming(0, { duration: 200 });
                      },
                    })}
              >
                {!web && (
                  <AnimatedView
                    style={[StyleSheet.absoluteFill, fillStyle]}
                    backgroundColor="$interactiveOnBaseBrandDefault"
                    opacity={0.2}
                    borderTopRightRadius="$r3"
                    borderBottomRightRadius="$r3"
                    pointerEvents="none"
                  />
                )}
                <Button.Text>
                  {web
                    ? t("Send {{symbol}}", { symbol: destination?.symbol ?? "" })
                    : t("Hold to send {{symbol}}", { symbol: destination?.symbol ?? "" })}
                </Button.Text>
                <Button.Icon>
                  <ArrowRight size={20} />
                </Button.Icon>
              </Button>
            </YStack>
            <AnimatePresence>
              {failure && (
                <YStack
                  key={failure}
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  backgroundColor="$backgroundMild"
                  animation="default"
                  animateOnly={["opacity"]}
                  opacity={1}
                  enterStyle={{ opacity: 0 }}
                  exitStyle={{ opacity: 0 }}
                >
                  <YStack flex={1} gap="$s6" alignItems="center" padding="$s7">
                    <OctagonX size={48} color="$uiErrorSecondary" />
                    <Text title primary textAlign="center">
                      {failure === "route"
                        ? t("No route available for this transfer.")
                        : failure === "liquidity"
                          ? t("Not enough liquidity for this amount currently")
                          : failure === "prepare"
                            ? t("We couldn’t prepare this transfer")
                            : t("We can’t get a quote right now")}
                    </Text>
                    <Text body secondary textAlign="center">
                      {failure === "route"
                        ? t("Try sending a different asset or network")
                        : failure === "liquidity"
                          ? t("Try sending a smaller amount")
                          : t("Try again in a moment")}
                    </Text>
                  </YStack>
                  <Button
                    primary
                    loading={
                      failure !== "route" &&
                      failure !== "liquidity" &&
                      (isRouteFetching || isTokensFetching || isErc20TransferSimulating || isTransferEstimating)
                    }
                    onPress={() => {
                      if (failure === "route") {
                        router.dismissTo("/send-funds/asset");
                      } else if (failure === "liquidity") {
                        router.dismissTo({
                          pathname: "/send-funds/amount",
                          params: { asset: assetParameter, fromChain, toChain, toToken },
                        });
                      } else if (failure === "prepare" && !routed) {
                        if (market) {
                          queryClient.invalidateQueries({ queryKey: ["simulateBlocks"] }).catch(reportError);
                        } else {
                          (isNativeTransfer
                            ? refetchTransferEstimate()
                            : Promise.all([refetchErc20Transfer(), refetchTransferEstimate()])
                          ).catch(reportError);
                        }
                      } else if (destinationFailure) {
                        refetchTokens().catch(reportError);
                      } else {
                        refetchRoute().catch(reportError);
                      }
                    }}
                  >
                    <Button.Text>
                      {failure === "route"
                        ? t("Change send asset")
                        : failure === "liquidity"
                          ? t("Change send amount")
                          : t("Try again")}
                    </Button.Text>
                    <Button.Icon>
                      <ArrowRight size={20} />
                    </Button.Icon>
                  </Button>
                </YStack>
              )}
            </AnimatePresence>
          </YStack>
        </View>
      </SafeView>
    );
  }

  return (
    <GradientScrollView variant={sendError ? "error" : success ? (processing ? "info" : "success") : "neutral"}>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <IconButton
            alignSelf="flex-start"
            icon={X}
            aria-label={t("Close")}
            onPress={() => {
              router.dismissTo(exit);
            }}
          />
          <XStack justifyContent="center" alignItems="center">
            <Square
              size={80}
              borderRadius="$r4"
              backgroundColor={
                sendError
                  ? "$interactiveBaseErrorSoftDefault"
                  : success
                    ? processing
                      ? "$interactiveBaseInformationSoftDefault"
                      : "$interactiveBaseSuccessSoftDefault"
                    : "$backgroundStrong"
              }
            >
              {pending && <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />}
              {success && processing && <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />}
              {success && !processing && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
              {sendError && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              <Trans
                i18nKey={
                  pending
                    ? "Sending to <em>{{recipient}}</em>"
                    : sendError
                      ? "Failed to send to <em>{{recipient}}</em>"
                      : processing
                        ? "Processing send to <em>{{recipient}}</em>"
                        : "Sent to <em>{{recipient}}</em>"
                }
                values={{ recipient: shortenHex(receiver, 5, 7) }}
                components={{ em: <Text emphasized primary body color="$uiNeutralPrimary" /> }}
              />
            </Text>
            <Text title primary color="$uiNeutralPrimary">
              {`$${receivedUSD.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </Text>
            <XStack gap="$s2" alignItems="center">
              <Text emphasized secondary subHeadline>
                {receivedTokens.toLocaleString(language, { maximumFractionDigits: 8 })}
              </Text>
              <Text emphasized secondary subHeadline>
                &nbsp;{received?.symbol}&nbsp;
              </Text>
              <AssetLogo height={16} uri={received?.logoURI} symbol={received?.symbol} width={16} />
            </XStack>
            {routed && success && (
              <Text caption secondary textAlign="center">
                {delivery(routeStatus, networkName, t)}
              </Text>
            )}
          </YStack>
        </YStack>
        {(success || sendError) && (
          <TransactionDetails
            hash={hash}
            chainId={payChain}
            fee={
              sponsored
                ? undefined
                : networkFeeUSD === undefined
                  ? "—"
                  : `$${networkFeeUSD.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            }
          />
        )}
      </View>
      {!pending && (
        <YStack flex={2} justifyContent="flex-end" gap="$s5">
          {success && (
            <View padded alignItems="center">
              <Text
                emphasized
                footnote
                color="$interactiveBaseBrandDefault"
                alignSelf="center"
                hitSlop={20}
                cursor="pointer"
                onPress={() => {
                  router.dismissTo(exit);
                }}
              >
                {processing ? t("View pending requests") : t("Close")}
              </Text>
            </View>
          )}
          {sendError && (
            <YStack alignItems="center" gap="$s4">
              <Pressable onPress={retry}>
                <Text emphasized footnote color="$uiBrandSecondary">
                  {t("Close")}
                </Text>
              </Pressable>
            </YStack>
          )}
        </YStack>
      )}
    </GradientScrollView>
  );
}

function Detail({ label, info, children }: { children: React.ReactNode; info?: boolean; label: string }) {
  return (
    <XStack gap="$s2" alignItems="center">
      <Text footnote secondary>
        {label}
      </Text>
      {info && <Info size={12} color="$uiNeutralSecondary" />}
      <XStack flex={1} justifyContent="flex-end">
        {children}
      </XStack>
    </XStack>
  );
}

function delivery(status: StatusResponse | undefined, network: string, t: TFunction) {
  if (status?.substatus === "REFUNDED") return t("Funds refunded to your account"); // cspell:ignore substatus
  if (status?.substatus === "PARTIAL") return t("Delivered on {{network}} with different tokens", { network });
  if (status?.status === "DONE") return t("Funds delivered on {{network}}", { network });
  if (status?.status === "FAILED") return t("Transfer failed on {{network}}", { network });
  if (status?.substatus === "WAIT_DESTINATION_TRANSACTION") return t("Waiting for {{network}}", { network });
  if (status?.substatus === "REFUND_IN_PROGRESS") return t("Refunding your funds");
  return t("Delivering on {{network}}", { network });
}

function classify(error: unknown) {
  let current = error;
  while (current && typeof current === "object") {
    const { cause, message, responseBody } = current as {
      cause?: unknown;
      message?: string;
      responseBody?: {
        code?: number;
        errors?: { failed?: { subpaths: Record<string, { code: string }[]> }[]; filteredOut?: { reason: string }[] };
      };
    };
    if (message === nativeFeeRoute) return "route";
    if (responseBody?.code === 1002) {
      const { failed, filteredOut } = responseBody.errors ?? {};
      return failed?.some(({ subpaths }) =>
        Object.values(subpaths)
          .flat()
          .some(({ code }) => liquidityCodes.has(code)),
      ) || filteredOut?.some(({ reason }) => /price impact|amount/i.test(reason))
        ? "liquidity"
        : "route";
    }
    current = cause;
  }
  return "quote";
}

const liquidityCodes = new Set([
  "AMOUNT_TOO_HIGH",
  "AMOUNT_TOO_LOW",
  "FEES_HIGHER_THAN_AMOUNT",
  "INSUFFICIENT_LIQUIDITY",
]);
