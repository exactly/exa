import React, { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Platform, StyleSheet } from "react-native";
import { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { impactAsync, ImpactFeedbackStyle, notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, CircleHelp, Info, OctagonX, TriangleAlert, X } from "@tamagui/lucide-icons";
import { AnimatePresence, ScrollView, Separator, Square, XStack, YStack } from "tamagui";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
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
import { useReadContract, useSimulateContract } from "wagmi";

import chain, { marketWETHAddress } from "@exactly/common/generated/chain";
import { proposalManagerAbi } from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import { estimateCalls } from "../../utils/accountClient";
import alchemyChainById from "../../utils/alchemyChains";
import ensOptions, { ensName } from "../../utils/ensOptions";
import executionOptions from "../../utils/executionOptions";
import { presentArticle } from "../../utils/intercom";
import {
  balancesOptions,
  classify,
  getRouteFrom,
  lifiChainsOptions,
  lifiTokensOptions,
  quoteValidity,
  statusOptions,
  trackable,
} from "../../utils/lifi";
import parseAmount from "../../utils/parseAmount";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useCrossChainGas from "../../utils/useCrossChainGas";
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

import type { ExtendedTransactionInfo } from "@lifi/sdk";

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
    ens: ensParameter,
  } = useLocalSearchParams();
  const payParse = safeParse(Address, assetParameter);
  const pay = payParse.success ? payParse.output : undefined;
  const zeroAddress = parse(Address, viemZeroAddress);
  const receiver = typeof receiverParameter === "string" ? receiverParameter : "";
  const name = typeof ensParameter === "string" ? ensName(ensParameter) : undefined;
  const receiverParse = safeParse(Address, receiverParameter);
  const receiverHex = receiverParse.success ? receiverParse.output : undefined;
  const payChain = typeof fromChain === "string" ? Number(fromChain) : chain.id;
  const destinationChain = typeof toChain === "string" ? Number(toChain) : chain.id;
  const destinationAmount = typeof amount === "string" && /^\d+$/.test(amount) ? BigInt(amount) : 0n;
  const { data: resolved } = useQuery(ensOptions(name, destinationChain));
  const ens = name && resolved === receiverHex ? name : "";

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
  const payDelivered = market?.market === marketWETHAddress ? zeroAddress : payUnderlying;

  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: tokens, isFetching: isTokensFetching, refetch: refetchTokens } = useQuery(lifiTokensOptions);
  const networkName =
    chains?.find((item) => item.id === destinationChain)?.name ??
    alchemyChainById.get(destinationChain)?.name ??
    chain.name;
  const destination = useMemo(() => {
    if (typeof toToken !== "string") return;
    if (
      destinationChain === payChain &&
      payDelivered &&
      paySymbol &&
      toToken.toLowerCase() === payDelivered.toLowerCase()
    ) {
      return {
        address: payDelivered,
        decimals: payDecimals,
        logoURI: external?.logoURI,
        price: payPrice,
        symbol: paySymbol,
      };
    }
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
  }, [toToken, tokens, destinationChain, payChain, payDelivered, paySymbol, payDecimals, payPrice, external?.logoURI]);

  const destinationAddress = destination?.address;
  const routed =
    destinationChain !== payChain ||
    (typeof toToken === "string" && toToken.toLowerCase() !== payDelivered?.toLowerCase());

  const fromAmount = routed
    ? typeof fromAmountParameter === "string" && /^\d+$/.test(fromAmountParameter)
      ? BigInt(fromAmountParameter)
      : 0n
    : destinationAmount;

  const [confirmed, setConfirmed] = useState<Awaited<ReturnType<typeof getRouteFrom>>>();
  const [denied, setDenied] = useState<string[]>([]);
  const [enableSimulations, setEnableSimulations] = useState(true);

  const {
    request: proposeSimulation,
    error: proposeError,
    isPending: isProposePending,
    queued,
    refetch: refetchPropose,
  } = useSimulateProposal({
    account: address,
    amount: fromAmount,
    market: market?.market,
    proposalType: ProposalType.Withdraw,
    receiver: receiverHex,
    enabled:
      enableSimulations &&
      !routed &&
      !!market &&
      !!address &&
      fromAmount > 0n &&
      !!receiverHex &&
      receiverHex !== zeroAddress,
  });

  const {
    data: quote,
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
        nativeless: !!market, // cspell:ignore nativeless
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
  const route = confirmed ?? quote;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!routeUpdatedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [routeUpdatedAt]);
  const quoteSeconds = route
    ? Math.max(0, Math.ceil((routeUpdatedAt + quoteValidity / 3 - Math.max(now, routeUpdatedAt)) / 1000))
    : undefined;
  const quoteExpired = !!route && now >= routeUpdatedAt + quoteValidity;

  const neutralAsset = useMemo(() => {
    const { success, output } = safeParse(Address, markets?.find(({ asset }) => asset !== payUnderlying)?.asset);
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
    enabled: enableSimulations && routed && !!market && !!address && !!route && !!neutralAsset && fromAmount > 0n,
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
        enableSimulations &&
        !routed &&
        !!external &&
        !isNativeTransfer &&
        !!address &&
        fromAmount > 0n &&
        !!receiverHex &&
        receiverHex !== zeroAddress,
    },
  });

  const { data: approved, refetch: refetchAllowance } = useReadContract({
    address: payUnderlying ? getAddress(payUnderlying) : undefined,
    chainId: payChain,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && route ? [address, getAddress(route.estimate.approvalAddress)] : undefined,
    query: { enabled: routed && !isNativeTransfer && !!address && !!payUnderlying && !!route, staleTime: 0 },
  });
  const calls = useMemo(() => {
    if (!external || !address || fromAmount <= 0n) return;
    if (routed) {
      if (!route || !payUnderlying || (!isNativeTransfer && approved === undefined)) return;
      return routeCalls(route, payUnderlying, isNativeTransfer ? maxUint256 : (approved ?? 0n));
    }
    if (!receiverHex || receiverHex === zeroAddress) return;
    return [
      isNativeTransfer
        ? { to: receiverHex, value: fromAmount }
        : {
            to: externalAddress,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [receiverHex, fromAmount] }),
          },
    ];
  }, [
    address,
    approved,
    external,
    externalAddress,
    fromAmount,
    isNativeTransfer,
    payUnderlying,
    receiverHex,
    route,
    routed,
    zeroAddress,
  ]);
  const {
    data: transferEstimate,
    error: transferEstimateError,
    isFetching: isTransferEstimating,
    isPlaceholderData: isTransferEstimateStale,
    refetch: refetchTransferEstimate,
  } = useQuery({
    queryKey: ["estimateCalls", payChain, calls],
    queryFn: () => {
      if (!calls) throw new Error("no calls ready");
      return estimateCalls(exa, payChain, calls);
    },
    enabled: enableSimulations && !!calls,
    placeholderData: keepPreviousData,
  });

  const payNetwork = chains?.find((item) => item.id === payChain);
  const nativeToken = payNetwork?.nativeToken;
  const sponsored = payChain === chain.id;
  const networkCost = sponsored ? 0n : nativeToken ? transferEstimate : undefined;
  const networkFeeUSD = sponsored
    ? 0
    : networkCost !== undefined && nativeToken
      ? Number(formatUnits(networkCost, nativeToken.decimals)) * Number(nativeToken.priceUSD)
      : undefined;
  const routeValue = routed ? (route?.value ?? 0n) : 0n;
  const {
    erc20GasReserve,
    feeIsSource,
    gasToken,
    insufficientGas,
    nativeGasReserve,
    paymasterAddress,
    sendCalls,
    submitted,
  } = useCrossChainGas({
    account: address,
    amount: fromAmount,
    chainId: payChain,
    networkCost,
    token: external,
    value: routed ? routeValue : undefined,
  });
  const {
    mutate: send,
    data: receipt,
    isPending: pending,
    isSuccess: success,
    isError: sendError,
    submittedAt,
    reset,
  } = useMutation({
    onMutate() {
      setEnableSimulations(false);
    },
    onSuccess() {
      if (external) queryClient.invalidateQueries({ queryKey: ["lifi", "balances"] }).catch(reportError);
    },
    async mutationFn() {
      if ((!sendReady && !submitted) || !receiver) throw new Error("not ready");
      if (routed) {
        if (!route || !payUnderlying) throw new Error("no route ready");
        setConfirmed(route);
        if (bridgePropose) {
          const { address: to, abi, functionName, args } = bridgePropose;
          return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
        }
        const { data: allowed = 0n } = isNativeTransfer ? { data: maxUint256 } : await refetchAllowance();
        return sendCalls(routeCalls(route, payUnderlying, allowed));
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
      setEnableSimulations(true);
      if (reportError(error).authKnown) retry();
    },
  });

  const web = Platform.OS === "web";
  const hold = useSharedValue(0);

  function retry() {
    hold.value = 0;
    if (submitted) {
      send();
      return;
    }
    setConfirmed(undefined);
    reset();
  }

  function held() {
    notificationAsync(NotificationFeedbackType.Success).catch(reportError);
    send();
  }

  /* istanbul ignore next */
  const fillStyle = useAnimatedStyle(() => ({ width: `${hold.value * 100}%` }));

  const sendReady = useMemo(() => {
    if (fromAmount <= 0n || !destination || insufficientGas || quoteExpired) return false;
    const estimated = !!transferEstimate && !isTransferEstimateStale;
    if (routed) return !!route && (market ? !!bridgePropose : !!payUnderlying && estimated);
    return market ? !!proposeSimulation : !!external && estimated && (isNativeTransfer || !!erc20TransferSimulation);
  }, [
    bridgePropose,
    destination,
    external,
    fromAmount,
    insufficientGas,
    isNativeTransfer,
    isTransferEstimateStale,
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
  const { data: execution } = useQuery(executionOptions(address, proposal?.nonce, proposal?.since));
  const executionHash = execution?.executed ? execution.hash : undefined;
  const { data: routeStatus } = useQuery(
    statusOptions(
      routed ? (proposal ? executionHash : hash) : undefined,
      destinationChain,
      route?.tool,
      payChain,
      route?.estimate.executionDuration,
    ),
  );
  const failed =
    (sendError && !submitted) ||
    execution?.executed === false ||
    routeStatus?.status === "FAILED" ||
    routeStatus?.substatus === "REFUNDED"; // cspell:ignore substatus
  const processing =
    !failed &&
    (routed && destinationChain !== payChain
      ? trackable && routeStatus?.status !== "DONE"
      : !!proposal && !executionHash);
  useEffect(() => {
    if (routeStatus?.status !== "DONE" && routeStatus?.status !== "FAILED") return;
    queryClient.invalidateQueries({ queryKey: ["lifi", "balances"] }).catch(reportError);
  }, [routeStatus?.status]);
  const exit = market ? "/activity" : "/";

  const { data: recentContacts } = useQuery<undefined | { address: Address; date?: number; ens: string }[]>({
    queryKey: ["contacts", "recent"],
  });

  useEffect(() => {
    if (success && receiverHex && !recentContacts?.some((contact) => contact.address === receiverHex)) {
      queryClient.setQueryData<undefined | { address: Address; date?: number; ens: string }[]>(
        ["contacts", "recent"],
        (old) => [{ address: receiverHex, ens, date: Date.now() }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [success, receiverHex, ens, recentContacts]);

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
    const quoted = routed ? route?.toAmount : destinationAmount;
    return destination && quoted !== undefined ? { ...destination, amount: quoted } : undefined;
  }, [routeStatus, routed, route?.toAmount, destination, destinationAmount]);
  const receivedTokens = received ? Number(formatUnits(received.amount, received.decimals)) : 0;
  const receivedUSD = received ? Number(formatUnits((received.amount * received.price) / WAD, received.decimals)) : 0;

  const totalAmount = route ? BigInt(route.estimate.fromAmount) : fromAmount;
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
    ? market
      ? bridgeProposeError
      : transferEstimateError
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
            : queued
              ? "queued"
              : "prepare"
        : destinationFailure
          ? "quote"
          : undefined;
  const highFee = feePercent !== undefined && feePercent > 3;
  const fee =
    insufficientGas && nativeToken
      ? gasToken && feeIsSource && paymasterAddress && erc20GasReserve > 0n
        ? { reserve: erc20GasReserve, token: gasToken, network: undefined }
        : { reserve: routeValue + nativeGasReserve, token: nativeToken, network: payNetwork.name }
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

  const invalidReceiver = !receiver || receiverHex === zeroAddress || (!routed && !receiverHex);
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
                        {ens || shortenHex(receiver, 4, 6)}
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
                                {`${Number(formatUnits(totalAmount, payDecimals)).toLocaleString(language, { maximumFractionDigits: 8 })} ${paySymbol}`}
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
                      : denied.length > 0 && !route && isRouteFetching
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
                    ? route
                      ? !market && !transferEstimate && isTransferEstimating
                      : isRouteFetching || (!destination && isTokensFetching)
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
                          : failure === "queued"
                            ? t("You have a pending request")
                            : failure === "prepare"
                              ? t("We couldn’t prepare this transfer")
                              : t("We can’t get a quote right now")}
                    </Text>
                    <Text body secondary textAlign="center">
                      {failure === "route"
                        ? t("Try sending a different asset or network")
                        : failure === "liquidity"
                          ? t("Try sending a smaller amount")
                          : failure === "queued"
                            ? t("Wait for it to be processed before sending again")
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
                      } else if ((failure === "prepare" || failure === "queued") && !routed) {
                        if (market) {
                          refetchPropose().catch(reportError);
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
    <GradientScrollView variant={failed ? "error" : success ? (processing ? "info" : "success") : "neutral"}>
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
                failed
                  ? "$interactiveBaseErrorSoftDefault"
                  : success
                    ? processing
                      ? "$interactiveBaseInformationSoftDefault"
                      : "$interactiveBaseSuccessSoftDefault"
                    : "$backgroundStrong"
              }
            >
              {(pending || (sendError && !!submitted)) && (
                <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />
              )}
              {success && processing && <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />}
              {success && !processing && !failed && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
              {failed && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body textAlign={sendError && !failed ? "center" : undefined}>
              <Trans
                i18nKey={
                  pending
                    ? "Sending to <em>{{recipient}}</em>"
                    : failed
                      ? "Failed to send to <em>{{recipient}}</em>"
                      : sendError
                        ? "Couldn't confirm send to <em>{{recipient}}</em>"
                        : processing
                          ? "Processing send to <em>{{recipient}}</em>"
                          : "Sent to <em>{{recipient}}</em>"
                }
                values={{ recipient: ens || shortenHex(receiver, 5, 7) }}
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
                {routeStatus?.substatus === "REFUNDED"
                  ? t("Funds refunded to your account")
                  : routeStatus?.substatus === "PARTIAL"
                    ? t("Delivered on {{network}} with different tokens", { network: networkName })
                    : routeStatus?.status === "DONE"
                      ? t("Funds delivered on {{network}}", { network: networkName })
                      : routeStatus?.status === "FAILED"
                        ? t("Transfer failed on {{network}}", { network: networkName })
                        : routeStatus?.substatus === "WAIT_DESTINATION_TRANSACTION"
                          ? t("Waiting for {{network}}", { network: networkName })
                          : routeStatus?.substatus === "REFUND_IN_PROGRESS"
                            ? t("Refunding your funds")
                            : t("Delivering on {{network}}", { network: networkName })}
              </Text>
            )}
            {routed && processing && (
              <Text caption secondary textAlign="center">
                {now - submittedAt > arrivalMinutes * 120_000
                  ? t("Taking longer than expected. You can close this screen safely.")
                  : t("Estimated arrival ~{{minutes}} min", { minutes: arrivalMinutes })}
              </Text>
            )}
          </YStack>
        </YStack>
        {(success || sendError) && (
          <TransactionDetails
            hash={execution?.hash ?? hash}
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
                {processing && proposal ? t("View pending requests") : t("Close")}
              </Text>
            </View>
          )}
          {sendError && (
            <View padded gap="$s4">
              <Button primary onPress={retry}>
                <Button.Text>{submitted ? t("Check status") : t("Try again")}</Button.Text>
                <Button.Icon>
                  <ArrowRight size={20} />
                </Button.Icon>
              </Button>
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
                {t("Close")}
              </Text>
            </View>
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

function routeCalls(route: Awaited<ReturnType<typeof getRouteFrom>>, underlying: string, allowed: bigint) {
  const required = BigInt(route.estimate.fromAmount);
  return [
    ...(allowed >= required ? [] : allowed > 0n ? [0n, required] : [required]).map((value) => ({
      to: getAddress(underlying),
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [getAddress(route.estimate.approvalAddress), value],
      }),
    })),
    { to: route.to, data: route.data, value: route.value },
  ];
}
