import chain, { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import shortenHex from "@exactly/common/shortenHex";
import { WAD } from "@exactly/lib";
import type { Chain, Token } from "@lifi/sdk";
import { ArrowLeft, Check, CircleHelp, Clock, Repeat, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { switchChain, waitForTransactionReceipt } from "@wagmi/core";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, Spinner, Square, XStack, YStack } from "tamagui";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Hex,
  UserRejectedRequestError,
  zeroAddress,
  TransactionExecutionError,
  getAddress,
} from "viem";
import { useReadContract, useSendCalls, useSendTransaction, useSimulateContract, useWriteContract } from "wagmi";

import AssetSelectSheet from "./AssetSelectSheet";
import TokenLogo from "./TokenLogo";
import OptimismImage from "../../assets/images/optimism.svg";
import { getRouteFrom, getBridgeSources, tokenCorrelation, type RouteFrom, type BridgeSources } from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import ownerConfig from "../../utils/wagmi/owner";
import AssetLogo from "../shared/AssetLogo";
import GradientScrollView from "../shared/GradientScrollView";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import ExaSpinner from "../shared/Spinner";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";
import TokenInput from "../swaps/TokenInput";

export default function Bridge() {
  const router = useRouter();
  const toast = useToastController();

  const [assetSheetOpen, setAssetSheetOpen] = useState(false);
  const [destinationModalOpen, setDestinationModalOpen] = useState(false);

  const { address: account } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [zeroAddress] });

  const [selectedSource, setSelectedSource] = useState<{ chain: number; address: string } | undefined>();
  const [selectedDestinationAddress, setSelectedDestinationAddress] = useState<string | undefined>();
  const [sourceAmount, setSourceAmount] = useState<bigint>(0n);

  const [bridgeStatus, setBridgeStatus] = useState<string | undefined>();
  const [bridgePreview, setBridgePreview] = useState<{ sourceToken: Token; sourceAmount: bigint } | undefined>();

  const senderConfig = ownerConfig;
  const { address: senderAddress } = useAccount({ config: senderConfig });
  const { mutateAsync: sendTx } = useSendTransaction({ config: senderConfig });
  const { mutateAsync: sendCallsTx } = useSendCalls({ config: senderConfig });
  const { mutateAsync: transfer } = useWriteContract({ config: senderConfig });

  const protocolSymbols = useMemo(() => {
    if (!markets) return [];
    return [
      ...new Set([
        ...markets
          .map((market) => market.symbol.slice(3))
          .filter((symbol) => symbol !== "USDC.e" && symbol !== "DAI" && symbol !== "WETH"),
        "ETH",
      ]),
    ];
  }, [markets]);

  const { data: bridge, isPending: isSourcesPending } = useQuery<BridgeSources>({
    queryKey: ["bridge", "sources", senderAddress, protocolSymbols],
    queryFn: () => getBridgeSources(senderAddress ?? undefined, protocolSymbols),
    staleTime: 60_000,
    enabled: !!senderAddress && !!markets && protocolSymbols.length > 0,
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  const chains = bridge?.chains;
  const ownerAssetsByChain = bridge?.ownerAssetsByChain;
  const usdByToken = bridge?.usdByToken;

  const assetGroups = useMemo(() => {
    if (!chains) return [];
    return chains.reduce<{ chain: Chain; assets: { token: Token; balance: bigint; usdValue: number }[] }[]>(
      (accumulator, chainItem) => {
        const assets = ownerAssetsByChain?.[chainItem.id] ?? [];
        if (assets.length > 0) accumulator.push({ chain: chainItem, assets });
        return accumulator;
      },
      [],
    );
  }, [chains, ownerAssetsByChain]);

  const previousSourceAddress = useRef<string | undefined>(undefined);

  const selectedGroup = assetGroups.find((group) => group.chain.id === selectedSource?.chain);
  const selectedAsset = selectedGroup?.assets.find((asset) => asset.token.address === selectedSource?.address);

  const sourceToken = selectedAsset?.token;
  const sourceBalance = selectedAsset?.balance ?? 0n;
  const sourceTokenAddress = sourceToken?.address;
  const sourceTokenSymbol = sourceToken?.symbol;

  const insufficientBalance = sourceAmount > sourceBalance;
  const isSameChain = selectedSource?.chain === chain.id;
  const isNativeSource = selectedSource?.address === zeroAddress;

  const destinationTokens = useMemo(() => bridge?.tokensByChain[chain.id] ?? [], [bridge?.tokensByChain]);
  const destinationBalances = useMemo(() => bridge?.balancesByChain[chain.id] ?? [], [bridge?.balancesByChain]);
  const destinationToken = destinationTokens.find((token) => token.address === selectedDestinationAddress);
  const destinationBalance = destinationToken
    ? (destinationBalances.find((item) => item.address === destinationToken.address)?.amount ?? 0n)
    : 0n;

  const destinationAssetGroups = useMemo(() => {
    if (destinationTokens.length === 0) return [];
    const chainMatch = chains?.find((item) => item.id === chain.id);
    const chainData: Pick<Chain, "id" | "name" | "logoURI"> = chainMatch ?? {
      id: chain.id,
      name: chain.name,
      logoURI: undefined,
    };
    const assets = destinationTokens
      .filter((token) => token.logoURI && protocolSymbols.includes(token.symbol))
      .map((token) => {
        const balance = destinationBalances.find((item) => item.address === token.address)?.amount ?? 0n;
        const usdKey = `${chain.id}:${token.address}`;
        const usdValue = usdByToken?.[usdKey] ?? 0;
        return {
          token: token.symbol === "wstETH" ? { ...token, name: "Wrapped Staked ETH" } : token,
          balance,
          usdValue,
        };
      });
    return [{ chain: chainData, assets }];
  }, [chains, destinationBalances, destinationTokens, protocolSymbols, usdByToken]);

  const bridgeQuoteEnabled =
    !!senderAddress &&
    !!account &&
    !!selectedSource &&
    !!sourceToken &&
    !!destinationToken &&
    sourceAmount > 0n &&
    !insufficientBalance &&
    !isSameChain;

  const {
    data: bridgeQuote,
    error: bridgeQuoteError,
    isFetching: isBridgeQuoteFetching,
  } = useQuery<RouteFrom>({
    queryKey: [
      "bridge",
      "quote",
      senderAddress,
      account,
      selectedSource?.chain,
      selectedSource?.address,
      destinationToken?.address,
      chain.id,
      selectedSource,
      sourceToken,
      destinationToken,
      sourceAmount,
      sourceToken?.address,
      isSameChain,
    ],
    queryFn: () => {
      if (
        !senderAddress ||
        !account ||
        !selectedSource ||
        !sourceToken ||
        !destinationToken ||
        sourceAmount === 0n ||
        isSameChain
      )
        throw new Error("invalid bridge parameters");
      return getRouteFrom({
        fromChainId: selectedSource.chain,
        toChainId: chain.id,
        fromTokenAddress: sourceToken.address,
        toTokenAddress: destinationToken.address,
        fromAmount: sourceAmount,
        fromAddress: senderAddress,
        toAddress: account,
      });
    },
    enabled: bridgeQuoteEnabled,
    refetchInterval: 15_000,
  });

  const toAmount = bridgeQuote ? BigInt(bridgeQuote.estimate.toAmount) : sourceAmount;

  const transferSimulationEnabled =
    isSameChain &&
    !isNativeSource &&
    !!senderAddress &&
    !!account &&
    !!selectedSource.address &&
    !!sourceToken &&
    sourceAmount > 0n &&
    !insufficientBalance;

  const {
    data: transferSimulation,
    error: transferSimulationError,
    isPending: isSimulatingTransfer,
  } = useSimulateContract({
    config: senderConfig,
    chainId: transferSimulationEnabled ? selectedSource.chain : undefined,
    address: transferSimulationEnabled ? getAddress(selectedSource.address) : undefined,
    abi: erc20Abi,
    functionName: "transfer",
    args: transferSimulationEnabled ? ([getAddress(account), sourceAmount] as const) : undefined,
    query: { enabled: transferSimulationEnabled },
  });

  const approvalTokenAddress =
    selectedSource?.address && isAddress(selectedSource.address) ? selectedSource.address : undefined;
  const approvalSpenderAddress = bridgeQuote?.estimate.approvalAddress;
  const approvalChainId = bridgeQuote?.chainId;

  const canReadAllowance =
    !!senderAddress &&
    !!approvalTokenAddress &&
    !!approvalChainId &&
    !!approvalSpenderAddress &&
    approvalSpenderAddress !== zeroAddress &&
    isAddress(approvalSpenderAddress);

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    config: senderConfig,
    abi: erc20Abi,
    address: canReadAllowance ? approvalTokenAddress : undefined,
    chainId: canReadAllowance ? approvalChainId : undefined,
    functionName: "allowance",
    args: canReadAllowance ? ([senderAddress, approvalSpenderAddress] as const) : undefined,
    query: { enabled: canReadAllowance, staleTime: 0 },
  });

  const {
    mutateAsync: executeBridge,
    isPending: isBridging,
    isSuccess: isBridgeSuccess,
    isError: isBridgeError,
    reset: resetBridgeMutation,
  } = useMutation<unknown, unknown, RouteFrom>({
    retry: false,
    mutationKey: ["bridge", "execute"],
    onMutate: (route) => {
      if (!sourceToken || !destinationToken) return;
      setBridgePreview({ sourceToken, sourceAmount: BigInt(route.estimate.fromAmount) });
    },
    mutationFn: async (from) => {
      if (!senderAddress || !selectedSource || !account) throw new Error("missing bridge context");
      if (isSameChain) throw new Error("invalid bridge context");

      setBridgeStatus(`Switching to ${selectedGroup?.chain.name ?? `Chain ${from.chainId}`}...`);
      await switchChain(senderConfig, { chainId: from.chainId });

      const spender = from.estimate.approvalAddress;
      const requiresApproval =
        !!spender &&
        spender !== zeroAddress &&
        selectedSource.address !== zeroAddress &&
        isAddress(spender) &&
        isAddress(selectedSource.address);

      let approval: Hex | undefined;
      let currentAllowance = allowanceData;
      if (requiresApproval) {
        setBridgeStatus("Checking allowance...");
        try {
          const result = await refetchAllowance();
          if (result.data !== undefined) {
            currentAllowance = result.data;
          }
        } catch (error) {
          reportError(error);
          currentAllowance = 0n;
        }
        const requiredAllowance = BigInt(from.estimate.fromAmount);
        const allowance = currentAllowance ?? 0n;

        if (allowance < requiredAllowance) {
          approval = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, requiredAllowance],
          });
        }
      }
      setBridgeStatus("Submitting bridge transaction...");
      try {
        await sendCallsTx({
          calls: [
            ...(approval ? [{ to: getAddress(selectedSource.address), data: approval }] : []),
            { to: from.to, data: from.data, value: from.value },
          ],
        });
        setBridgeStatus("Bridge transaction submitted");
      } catch {
        if (approval) {
          const hash = await sendTx({ to: getAddress(selectedSource.address), data: approval });
          await waitForTransactionReceipt(senderConfig, { hash });
        }
        const hash = await sendTx({ to: from.to, data: from.data, value: from.value });
        await waitForTransactionReceipt(senderConfig, { hash });
        setBridgeStatus("Bridge transaction submitted");
      }
    },
    onSuccess: async () => {
      toast.show("Bridge transaction submitted", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success", preset: "done" },
      });
      await queryClient.invalidateQueries({ queryKey: ["bridge", "sources"] });
    },
    onError: (error: unknown) => {
      handleError(error, toast);
    },
    onSettled: () => {
      setBridgeStatus(undefined);
    },
  });

  const {
    mutateAsync: executeTransfer,
    isPending: isTransferring,
    isSuccess: isTransferSuccess,
    isError: isTransferError,
    reset: resetTransferMutation,
  } = useMutation<unknown, unknown>({
    retry: false,
    mutationKey: ["bridge", "transfer"],
    onMutate: () => {
      if (!sourceToken) return;
      setBridgePreview({ sourceToken, sourceAmount });
    },
    mutationFn: async () => {
      if (!senderAddress || !selectedSource || !account) throw new Error("missing transfer context");
      if (!isSameChain) throw new Error("transfer mutation invoked for different chains");

      setBridgeStatus("Submitting transfer transaction...");
      const recipient = getAddress(account);
      let hash: Hex;
      if (isNativeSource) {
        hash = await sendTx({ to: recipient, value: sourceAmount });
      } else {
        if (!transferSimulation) throw new Error("missing transfer simulation");
        hash = await transfer(transferSimulation.request);
      }
      await waitForTransactionReceipt(senderConfig, { hash });
      setBridgeStatus("Transfer transaction submitted");
    },
    onSuccess: async () => {
      toast.show("Transfer transaction submitted", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success", preset: "done" },
      });
      await queryClient.invalidateQueries({ queryKey: ["bridge", "sources"] });
    },
    onError: (error: unknown) => {
      handleError(error, toast, true);
    },
    onSettled: () => {
      setBridgeStatus(undefined);
    },
  });

  const isLoadingAssets = isSourcesPending && !bridge;
  const isTransferSimulationPending = transferSimulationEnabled && isSimulatingTransfer;
  const isBridgeQuoteLoading = bridgeQuoteEnabled && isBridgeQuoteFetching;

  const canShowBridgeQuote = !isSameChain && !!bridgeQuote;
  const processing =
    !!bridgePreview &&
    (isBridging || isBridgeSuccess || isBridgeError || isTransferring || isTransferSuccess || isTransferError);

  const isActionDisabled =
    isSourcesPending ||
    isLoadingAssets ||
    isBridgeQuoteLoading ||
    isBridging ||
    isTransferring ||
    isTransferSimulationPending ||
    !senderAddress ||
    !account ||
    !sourceToken ||
    !destinationToken ||
    sourceAmount === 0n ||
    insufficientBalance ||
    (!isSameChain && !bridgeQuote);

  const statusMessage =
    isBridging || isTransferring
      ? (bridgeStatus ?? (isTransferring ? "Transferring..." : "Bridging..."))
      : isTransferSimulationPending
        ? "Simulating transfer..."
        : isBridgeQuoteLoading
          ? "Fetching best route..."
          : undefined;

  useEffect(() => {
    if (assetGroups.length === 0) {
      setSelectedSource(undefined);
      return;
    }

    if (
      !!selectedSource &&
      assetGroups.some(
        (group) =>
          group.chain.id === selectedSource.chain &&
          group.assets.some((asset) => asset.token.address === selectedSource.address),
      )
    ) {
      return;
    }

    const defaultChainId = bridge?.defaultChainId;
    const defaultTokenAddress = bridge?.defaultTokenAddress;

    const defaultGroup =
      defaultChainId && defaultTokenAddress
        ? assetGroups.find((group) => group.chain.id === defaultChainId)
        : undefined;
    const defaultAsset = defaultGroup?.assets.find((asset) => asset.token.address === defaultTokenAddress);

    const resolvedGroup = defaultAsset ? defaultGroup : assetGroups[0];
    const fallbackAsset = defaultAsset ?? assetGroups[0]?.assets[0];

    if (!resolvedGroup || !fallbackAsset) {
      setSelectedSource(undefined);
      return;
    }

    setSelectedSource({ chain: resolvedGroup.chain.id, address: fallbackAsset.token.address });
  }, [assetGroups, bridge?.defaultChainId, bridge?.defaultTokenAddress, selectedSource]);

  useEffect(() => {
    if (!sourceTokenAddress) {
      if (selectedDestinationAddress !== undefined) setSelectedDestinationAddress(undefined);
      previousSourceAddress.current = undefined;
      return;
    }

    if (previousSourceAddress.current === sourceTokenAddress && destinationToken) {
      previousSourceAddress.current = sourceTokenAddress;
      return;
    }

    const correlatedSymbol = sourceTokenSymbol && tokenCorrelation[sourceTokenSymbol as keyof typeof tokenCorrelation];
    const correlatedToken = correlatedSymbol
      ? destinationTokens.find((token) => token.symbol === correlatedSymbol)
      : undefined;
    const nextToken = correlatedToken ?? destinationTokens.find((token) => token.symbol === "USDC");
    const nextAddress = nextToken?.address;

    if (nextAddress !== selectedDestinationAddress) {
      setSelectedDestinationAddress(nextAddress);
    }

    previousSourceAddress.current = sourceTokenAddress;
  }, [destinationToken, destinationTokens, selectedDestinationAddress, sourceTokenAddress, sourceTokenSymbol]);

  if (processing) {
    const isPending = isBridging || isTransferring;
    const isSuccess = isBridgeSuccess || isTransferSuccess;
    const isError = isBridgeError || isTransferError;
    const isTransfer = isTransferring || isTransferSuccess || isTransferError;
    const label = isTransfer ? "Transfer" : "Bridge";
    return (
      <GradientScrollView variant={isError ? "error" : isSuccess ? "success" : "neutral"}>
        <View flex={1}>
          <YStack gap="$s7" paddingBottom="$s9">
            <Pressable
              onPress={() => {
                if (!isPending) {
                  setSourceAmount(0n);
                  setBridgePreview(undefined);
                  resetBridgeMutation();
                  resetTransferMutation();
                }
                router.replace("/(main)/(home)");
              }}
            >
              <X size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <YStack gap="$s4_5" justifyContent="center" alignItems="center">
              <Square
                size={80}
                borderRadius="$r4"
                backgroundColor={
                  isError
                    ? "$interactiveBaseErrorSoftDefault"
                    : isSuccess
                      ? "$interactiveBaseSuccessSoftDefault"
                      : "$backgroundStrong"
                }
              >
                {isPending && <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />}
                {isSuccess && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
                {isError && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
              </Square>
              <YStack gap="$s3" justifyContent="center" alignItems="center">
                <Text secondary body>
                  {isError
                    ? `${label} failed`
                    : isSuccess
                      ? `${label} transaction submitted`
                      : `Processing ${label.toLowerCase()}`}
                </Text>
              </YStack>
              <XStack gap="$s3" alignItems="center">
                <TokenLogo token={bridgePreview.sourceToken} size={32} />
                <Text title primary color="$uiNeutralPrimary">
                  {`${Number(
                    formatUnits(bridgePreview.sourceAmount, bridgePreview.sourceToken.decimals),
                  ).toLocaleString(undefined, {
                    maximumFractionDigits: Math.min(6, bridgePreview.sourceToken.decimals),
                  })} ${bridgePreview.sourceToken.symbol}`}
                </Text>
              </XStack>
              <Text emphasized secondary body textAlign="center">
                {(
                  Number(formatUnits(sourceAmount, bridgePreview.sourceToken.decimals)) *
                  Number(bridgePreview.sourceToken.priceUSD)
                ).toLocaleString(undefined, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })}
              </Text>
            </YStack>
          </YStack>
        </View>
        {!isPending && (
          <YStack flex={2} justifyContent="flex-end" gap="$s5" alignItems="center" paddingBottom="$s6">
            <Pressable
              onPress={() => {
                setSourceAmount(0n);
                setBridgePreview(undefined);
                resetBridgeMutation();
                resetTransferMutation();
                router.replace("/(main)/(home)");
              }}
            >
              <Text emphasized footnote color="$uiBrandSecondary" textAlign="center">
                Close
              </Text>
            </Pressable>
          </YStack>
        )}
      </GradientScrollView>
    );
  }

  return (
    <SafeView fullScreen>
      <View fullScreen>
        <View
          padded
          flexDirection="row"
          gap={10}
          paddingBottom="$s4"
          justifyContent="space-between"
          alignItems="center"
        >
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(main)/(home)");
              }
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <Text primary emphasized subHeadline>
            Add funds
          </Text>
          <Pressable
            onPress={() => {
              openBrowser("https://li.fi/").catch(reportError); // TODO replace with article
            }}
          >
            <CircleHelp color="$uiNeutralPrimary" />
          </Pressable>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} flex={1}>
          <View padded>
            <YStack gap="$s5">
              {isLoadingAssets && (
                <View
                  borderWidth={1}
                  borderColor="$borderNeutralSoft"
                  backgroundColor="$backgroundSoft"
                  borderRadius="$r3"
                  padding="$s4"
                  gap="$s3"
                >
                  <Skeleton height={20} width="60%" />
                  <Skeleton height={16} width="80%" />
                  <Skeleton height={48} width="100%" radius={12} />
                </View>
              )}
              {!isLoadingAssets && assetGroups.length === 0 && (
                <View
                  borderWidth={1}
                  borderColor="$borderWarningStrong"
                  backgroundColor="$interactiveBaseWarningSoftDefault"
                  borderRadius="$r3"
                  padding="$s4"
                  gap="$s3"
                >
                  <Text emphasized callout color="$interactiveOnBaseWarningSoft">
                    No external assets detected
                  </Text>
                  <Text footnote color="$interactiveOnBaseWarningSoft">
                    Top up an external wallet supported by LI.FI to unlock bridging into {chain.name}.
                  </Text>
                </View>
              )}
              {assetGroups.length > 0 && (
                <TokenInput
                  label="Send from"
                  subLabel={shortenHex(senderAddress ?? zeroAddress, 4, 6)}
                  token={sourceToken}
                  amount={sourceAmount}
                  balance={sourceBalance}
                  isLoading={isSourcesPending}
                  isActive
                  onTokenSelect={() => {
                    if (assetGroups.length > 0) setAssetSheetOpen(true);
                  }}
                  onChange={(value) => {
                    setSourceAmount(value);
                  }}
                  onUseMax={(maxAmount) => {
                    setSourceAmount(maxAmount);
                  }}
                  chainLogoUri={selectedGroup?.chain.id === 10 ? undefined : selectedGroup?.chain.logoURI}
                />
              )}
              {insufficientBalance && (
                <Text caption2 color="$interactiveOnBaseWarningSoft">
                  Amount exceeds available balance.
                </Text>
              )}
              {destinationToken && (
                <YStack
                  borderWidth={1}
                  borderColor={destinationModalOpen ? "$borderBrandStrong" : "$borderNeutralSoft"}
                  backgroundColor="$backgroundMild"
                  borderRadius="$r3"
                  padding="$s4_5"
                  gap="$s3"
                >
                  <XStack alignItems="center" justifyContent="space-between">
                    <YStack gap="$s1">
                      <Text emphasized subHeadline color="$uiNeutralPrimary">
                        {isSameChain ? "Destination" : "Destination asset"}
                      </Text>
                      <Text footnote color="$uiNeutralSecondary">
                        Exa Account | {shortenHex(account ?? zeroAddress, 4, 6)}
                      </Text>
                    </YStack>
                  </XStack>
                  {!isSameChain && (
                    <YStack gap="$s3_5">
                      <Pressable
                        onPress={() => {
                          if (destinationTokens.length > 0) setDestinationModalOpen(true);
                        }}
                        hitSlop={10}
                        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, width: "100%" })}
                      >
                        <XStack gap="$s3_5" alignItems="center" justifyContent="space-between" flex={1}>
                          <XStack gap="$s3_5" alignItems="center" flex={1}>
                            <View width={40} height={40} position="relative">
                              {destinationToken.logoURI ? (
                                <AssetLogo source={{ uri: destinationToken.logoURI }} width={40} height={40} />
                              ) : (
                                <TokenLogo token={destinationToken} size={40} />
                              )}
                              <View
                                position="absolute"
                                bottom={0}
                                right={0}
                                width={20}
                                height={20}
                                borderWidth={1}
                                borderColor="white"
                                borderRadius={10}
                                overflow="hidden"
                              >
                                <OptimismImage width="100%" height="100%" />
                              </View>
                            </View>
                            <YStack flex={1}>
                              {!!account && sourceAmount > 0n && !insufficientBalance && isBridgeQuoteLoading ? (
                                <Skeleton height={28} width="60%" />
                              ) : (
                                <Text
                                  primary
                                  emphasized
                                  title
                                  textAlign="left"
                                  flex={1}
                                  width="100%"
                                  color="$uiNeutralSecondary"
                                >
                                  {Number(formatUnits(toAmount, destinationToken.decimals)).toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: destinationToken.decimals,
                                    useGrouping: false,
                                  })}
                                </Text>
                              )}
                              <XStack justifyContent="space-between" alignItems="center" flex={1}>
                                {!!account && sourceAmount > 0n && !insufficientBalance && isBridgeQuoteLoading ? (
                                  <Skeleton height={16} width={100} />
                                ) : (
                                  <Text callout color="$uiNeutralPlaceholder">
                                    {`≈${Number(
                                      formatUnits(
                                        (toAmount * parseUnits(destinationToken.priceUSD, 18)) / WAD,
                                        destinationToken.decimals,
                                      ),
                                    ).toLocaleString(undefined, {
                                      style: "currency",
                                      currency: "USD",
                                      currencyDisplay: "narrowSymbol",
                                    })}`}
                                  </Text>
                                )}
                                <Text footnote color="$uiNeutralSecondary" textAlign="right">
                                  {`Balance: ${Number(
                                    formatUnits(
                                      (destinationBalance * parseUnits(destinationToken.priceUSD, 18)) / WAD,
                                      destinationToken.decimals,
                                    ),
                                  ).toLocaleString(undefined, {
                                    style: "currency",
                                    currency: "USD",
                                    currencyDisplay: "narrowSymbol",
                                  })}`}
                                </Text>
                              </XStack>
                            </YStack>
                          </XStack>
                        </XStack>
                      </Pressable>
                    </YStack>
                  )}
                </YStack>
              )}
              {senderAddress &&
                account &&
                sourceToken &&
                destinationToken &&
                !isBridgeQuoteLoading &&
                canShowBridgeQuote &&
                sourceAmount > 0n &&
                !insufficientBalance && (
                  <YStack gap="$s3_5">
                    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                      <Text caption color="$uiNeutralSecondary">
                        You send
                      </Text>
                      <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                        {`${Number(formatUnits(sourceAmount, sourceToken.decimals)).toLocaleString(undefined, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: sourceToken.decimals,
                          useGrouping: false,
                        })} ${sourceToken.symbol}`}
                      </Text>
                    </XStack>
                    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                      <Text caption color="$uiNeutralSecondary">
                        Source network
                      </Text>
                      <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                        {selectedGroup?.chain.name ?? (selectedSource?.chain ? `Chain ${selectedSource.chain}` : "—")}
                      </Text>
                    </XStack>
                    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                      <Text caption color="$uiNeutralSecondary">
                        Estimated arrival
                      </Text>
                      <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                        {bridgeQuote.estimate.toAmount
                          ? `≈${Number(
                              formatUnits(BigInt(bridgeQuote.estimate.toAmount), destinationToken.decimals),
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: destinationToken.decimals,
                              useGrouping: false,
                            })} ${destinationToken.symbol}`
                          : "—"}
                      </Text>
                    </XStack>
                    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                      <Text caption color="$uiNeutralSecondary">
                        Destination network
                      </Text>
                      <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                        {chain.name}
                      </Text>
                    </XStack>
                    {bridgeQuote.estimate.toAmountMin && (
                      <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                        <Text caption color="$uiNeutralSecondary">
                          Minimum received
                        </Text>
                        <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                          {`${Number(
                            formatUnits(BigInt(bridgeQuote.estimate.toAmountMin), destinationToken.decimals),
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: destinationToken.decimals,
                            useGrouping: false,
                          })} ${destinationToken.symbol}`}
                        </Text>
                      </XStack>
                    )}
                    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                      <Text caption color="$uiNeutralSecondary">
                        Fees
                      </Text>
                      <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                        0.25%
                      </Text>
                    </XStack>
                    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                      <Text caption color="$uiNeutralSecondary">
                        Slippage
                      </Text>
                      <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                        2%
                      </Text>
                    </XStack>
                    {bridgeQuote.estimate.executionDuration ? (
                      <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                        <Text caption color="$uiNeutralSecondary">
                          Estimated time
                        </Text>
                        <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                          {`~${Math.max(1, Math.round(bridgeQuote.estimate.executionDuration / 60))} min`}
                        </Text>
                      </XStack>
                    ) : null}
                    {(bridgeQuote.tool ?? bridgeQuote.estimate.tool) && (
                      <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                        <Text caption color="$uiNeutralSecondary">
                          Exchange
                        </Text>
                        <Text
                          caption
                          color="$uiNeutralPrimary"
                          textAlign="right"
                          flexShrink={1}
                          textTransform="uppercase"
                        >
                          {bridgeQuote.tool ?? bridgeQuote.estimate.tool}
                        </Text>
                      </XStack>
                    )}
                  </YStack>
                )}
              {statusMessage && (
                <XStack gap="$s3" alignItems="center">
                  <Spinner color="$uiBrandSecondary" size="small" />
                  <Text footnote color="$uiNeutralSecondary">
                    {statusMessage}
                  </Text>
                </XStack>
              )}
              {bridgeQuoteError && senderAddress && account && sourceAmount > 0n && !insufficientBalance && (
                <Text caption2 color="$interactiveOnBaseWarningSoft">
                  Unable to fetch a bridge quote right now. Please adjust the amount or try again later.
                </Text>
              )}
              {transferSimulationError &&
                isSameChain &&
                !isNativeSource &&
                sourceAmount > 0n &&
                !insufficientBalance && (
                  <Text caption2 color="$interactiveOnBaseWarningSoft">
                    Unable to simulate a transfer right now. Please adjust the amount or try again later.
                  </Text>
                )}
            </YStack>
          </View>
        </ScrollView>
        <View padded>
          <YStack
            gap="$s4"
            borderTopWidth={bridgeQuote?.estimate.approvalAddress ? 1 : 0}
            borderColor="$borderNeutralSoft"
            paddingTop="$s3"
          >
            {bridgeQuote?.estimate.approvalAddress && (
              <YStack>
                <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3">
                  <View>
                    <Clock size={16} width={16} height={16} color="$uiInfoSecondary" />
                  </View>
                  <XStack flex={1}>
                    <Text caption2 color="$uiNeutralPlaceholder">
                      Bridging assets may take up to 10 minutes.
                    </Text>
                  </XStack>
                </XStack>
              </YStack>
            )}
            <Button
              primary
              width="100%"
              alignItems="center"
              onPress={() => {
                if (isSameChain) {
                  executeTransfer().catch(reportError);
                  return;
                }
                if (!bridgeQuote) return;
                executeBridge(bridgeQuote).catch(reportError);
              }}
              disabled={isActionDisabled}
              loading={isBridging || isTransferring}
            >
              <Button.Text>
                {sourceToken ? `${isSameChain ? "Transfer" : "Bridge"} ${sourceToken.symbol}` : "Select source asset"}
              </Button.Text>
              <Button.Icon>
                <Repeat strokeWidth={2.5} />
              </Button.Icon>
            </Button>
          </YStack>
        </View>
        <AssetSelectSheet
          label="Select asset to send"
          open={assetSheetOpen}
          onClose={() => {
            setAssetSheetOpen(false);
          }}
          groups={assetGroups}
          selected={selectedSource}
          onSelect={(chainId, token) => {
            setSourceAmount(0n);
            setSelectedSource({ chain: chainId, address: token.address });
          }}
        />
        <AssetSelectSheet
          hideBalances
          label="Select asset to receive"
          open={destinationModalOpen}
          onClose={() => {
            setDestinationModalOpen(false);
          }}
          groups={destinationAssetGroups}
          selected={destinationToken ? { chain: chain.id, address: destinationToken.address } : undefined}
          onSelect={(_, token) => {
            setSelectedDestinationAddress(token.address);
            setDestinationModalOpen(false);
          }}
        />
      </View>
    </SafeView>
  );
}

function handleError(error: unknown, toast: ReturnType<typeof useToastController>, isTransfer?: boolean) {
  if (error instanceof UserRejectedRequestError) return;
  if (error instanceof TransactionExecutionError && error.shortMessage === "User rejected the request.") return;
  toast.show(`${isTransfer ? "Transfer" : "Bridge"} failed. Please try again.`, {
    native: true,
    duration: 1000,
    burntOptions: { haptic: "error", preset: "error" },
  });
  reportError(error);
}
