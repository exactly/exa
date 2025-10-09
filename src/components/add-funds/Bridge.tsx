import chain, { previewerAddress } from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import type { Chain, Token } from "@lifi/sdk";
import { ArrowLeft, Check, CircleHelp, Clock, Info, Repeat, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getCapabilities } from "@wagmi/core/actions";
import { useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, Spinner, Square, XStack, YStack } from "tamagui";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddress,
  parseUnits,
  type Address,
  type Hex,
  UserRejectedRequestError,
  zeroAddress,
  TransactionExecutionError,
} from "viem";
import { useReadContract, useSendCalls, useSendTransaction } from "wagmi";

import AssetSelectSheet from "./AssetSelectSheet";
import TokenLogo from "./TokenLogo";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import OptimismImage from "../../assets/images/optimism.svg";
import { useReadPreviewerExactly } from "../../generated/contracts";
import { config as injectedConfig, connectAccount, getConnector } from "../../utils/injectedConnector";
import { getRouteFrom, getBridgeSources, tokenCorrelation, type RouteFrom, type BridgeSources } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useOpenBrowser from "../../utils/useOpenBrowser";
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
  const navigation = useNavigation<AppNavigationProperties>();
  const toast = useToastController();
  const openBrowser = useOpenBrowser();

  const [assetSheetOpen, setAssetSheetOpen] = useState(false);
  const [destinationModalOpen, setDestinationModalOpen] = useState(false);

  const { address: account } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [zeroAddress] });

  const [selectedSource, setSelectedSource] = useState<{ chain: number; address: string } | undefined>();
  const [selectedDestinationAddress, setSelectedDestinationAddress] = useState<string | undefined>();
  const [sourceAmount, setSourceAmount] = useState<bigint>(0n);

  const [bridgeStatus, setBridgeStatus] = useState<string | undefined>();

  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const { sendTransactionAsync } = useSendTransaction({ config: injectedConfig });
  const { sendCallsAsync } = useSendCalls({ config: injectedConfig });

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

  const { data: bridge, isPending } = useQuery<BridgeSources>({
    queryKey: ["bridge", "sources", ownerAccount, protocolSymbols],
    queryFn: () => getBridgeSources(ownerAccount ?? undefined, protocolSymbols),
    staleTime: 60_000,
    enabled: !!ownerAccount && !!markets && protocolSymbols.length > 0,
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

  const previousSourceAddress = useRef<string | undefined>();

  const selectedGroup = assetGroups.find((group) => group.chain.id === selectedSource?.chain);
  const selectedAsset = selectedGroup?.assets.find((asset) => asset.token.address === selectedSource?.address);

  const sourceToken = selectedAsset?.token;
  const sourceBalance = selectedAsset?.balance ?? 0n;
  const sourceTokenAddress = sourceToken?.address;
  const sourceTokenSymbol = sourceToken?.symbol;

  const insufficientBalance = sourceAmount > sourceBalance;

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

  const {
    data: bridgeQuote,
    error: bridgeQuoteError,
    isPending: isBridgeQuotePending,
  } = useQuery<RouteFrom>({
    queryKey: [
      "bridge",
      "quote",
      ownerAccount,
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
    ],
    queryFn: () => {
      if (!ownerAccount || !account || !selectedSource || !sourceToken || !destinationToken || sourceAmount === 0n)
        throw new Error("invalid bridge parameters");
      return getRouteFrom({
        fromChainId: selectedSource.chain,
        toChainId: chain.id,
        fromTokenAddress: sourceToken.address,
        toTokenAddress: destinationToken.address,
        fromAmount: sourceAmount,
        fromAddress: ownerAccount,
        toAddress: account,
      });
    },
    enabled:
      !!ownerAccount &&
      !!account &&
      !!selectedSource &&
      !!sourceToken &&
      !!destinationToken &&
      sourceAmount > 0n &&
      !insufficientBalance,
    refetchInterval: 15_000,
  });

  const { data: isAtomicSendCallsReady, refetch: refetchAtomicSendCallsReady } = useQuery<boolean>({
    queryKey: ["bridge", "supports-send-calls", ownerAccount], // eslint-disable-line @tanstack/query/exhaustive-deps
    queryFn: async () => {
      if (!bridgeQuote?.chainId) return false;
      const capabilities = await getCapabilities(injectedConfig, {
        account: ownerAccount,
        connector: await getConnector(),
        chainId: bridgeQuote.chainId,
      });
      const atomicStatus =
        (capabilities as { atomic?: { status?: string } }).atomic?.status ??
        (capabilities as Record<number, { atomic?: { status?: string } }>)[bridgeQuote.chainId]?.atomic?.status;
      return atomicStatus === "ready";
    },
    enabled: !!ownerAccount && !!bridgeQuote?.chainId,
    staleTime: 30_000,
  });

  const approvalTokenAddress =
    selectedSource?.address && isAddress(selectedSource.address) ? selectedSource.address : undefined;
  const approvalSpenderAddress = bridgeQuote?.estimate.approvalAddress;
  const approvalChainId = bridgeQuote?.chainId;

  const canReadAllowance =
    !!ownerAccount &&
    !!approvalTokenAddress &&
    !!approvalChainId &&
    !!approvalSpenderAddress &&
    approvalSpenderAddress !== zeroAddress &&
    isAddress(approvalSpenderAddress);

  const { data: allowanceData, refetch: refetchAllowance } = useReadContract({
    config: injectedConfig,
    abi: erc20Abi,
    address: canReadAllowance ? approvalTokenAddress : undefined,
    chainId: canReadAllowance ? approvalChainId : undefined,
    functionName: "allowance",
    args: canReadAllowance ? ([ownerAccount, approvalSpenderAddress] as const) : undefined,
    query: { enabled: canReadAllowance, staleTime: 0 },
  });

  const {
    mutateAsync: executeBridge,
    isPending: isBridging,
    isSuccess: isBridgeSuccess,
    isError: isBridgeError,
    reset: resetBridgeMutation,
  } = useMutation<unknown, unknown, RouteFrom>({
    mutationKey: ["bridge", "execute"],
    mutationFn: async (quote: RouteFrom) => {
      if (!ownerAccount || !selectedSource) throw new Error("missing bridge context");
      setBridgeStatus("Connecting wallet...");
      await connectAccount(ownerAccount);
      const connector = await getConnector();
      const quoteChainId = quote.chainId;
      setBridgeStatus(`Switching to ${selectedGroup?.chain.name ?? `Chain ${quote.chainId}`}...`);
      await connector.switchChain?.({ chainId: quoteChainId });
      const approvalAddress = quote.estimate.approvalAddress;

      let shouldUseSendCalls = isAtomicSendCallsReady ?? false;
      if (isAtomicSendCallsReady === undefined) {
        const result = await refetchAtomicSendCallsReady();
        shouldUseSendCalls = result.data ?? false;
      }

      const batchedCalls: { to: Address; data?: Hex; value?: bigint }[] = [];

      const requiresApproval =
        !!approvalAddress &&
        approvalAddress !== zeroAddress &&
        selectedSource.address !== zeroAddress &&
        isAddress(approvalAddress) &&
        isAddress(selectedSource.address);
      let currentAllowance = allowanceData;

      if (requiresApproval) {
        setBridgeStatus("Checking allowance...");
        const tokenAddress = selectedSource.address as Address;
        const spender = approvalAddress;

        try {
          const result = await refetchAllowance();
          if (result.data !== undefined) {
            currentAllowance = result.data;
          }
        } catch (error) {
          reportError(error);
          currentAllowance = 0n;
        }

        const requiredAllowance = BigInt(quote.estimate.fromAmount);
        const allowance = currentAllowance ?? 0n;

        if (allowance < requiredAllowance) {
          const symbol = sourceToken?.symbol ?? "token";
          const approval = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [spender, requiredAllowance],
          });
          if (shouldUseSendCalls) {
            setBridgeStatus(`Batching ${symbol} approval...`);
            batchedCalls.push({ to: tokenAddress, data: approval, value: 0n });
          } else {
            setBridgeStatus(`Submitting ${symbol} approval...`);
            await sendTransactionAsync({
              connector,
              account: ownerAccount,
              chainId: quoteChainId,
              to: tokenAddress,
              data: approval,
              value: 0n,
            });
            setBridgeStatus("Approval transaction sent...");
          }
        }
      }
      setBridgeStatus("Submitting bridge transaction...");
      if (shouldUseSendCalls) {
        batchedCalls.push({ to: quote.to, data: quote.data, value: quote.value });
        const result = await sendCallsAsync({
          connector,
          account: ownerAccount,
          chainId: quoteChainId,
          calls: batchedCalls,
        });
        setBridgeStatus("Bridge transaction submitted");
        return result;
      }
      const hash = await sendTransactionAsync({
        connector,
        account: ownerAccount,
        chainId: quoteChainId,
        to: quote.to,
        data: quote.data,
        value: quote.value,
        gas: quote.gas,
        gasPrice: quote.gasPrice,
        maxFeePerGas: quote.maxFeePerGas,
        maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
      });
      setBridgeStatus("Bridge transaction submitted");
      return hash;
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
      if (error instanceof UserRejectedRequestError) return;
      if (error instanceof TransactionExecutionError && error.shortMessage === "User rejected the request.") return;
      toast.show("Bridge failed. Please try again.", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
      reportError(error);
    },
    onSettled: () => {
      setBridgeStatus(undefined);
    },
  });

  const isLoadingAssets = isPending && !bridge;

  const isActionDisabled =
    isPending ||
    isLoadingAssets ||
    isBridgeQuotePending ||
    isBridging ||
    !ownerAccount ||
    !account ||
    !sourceToken ||
    !destinationToken ||
    sourceAmount === 0n ||
    insufficientBalance ||
    !bridgeQuote;

  const statusMessage = isBridging
    ? (bridgeStatus ?? "Bridging...")
    : isBridgeQuotePending && sourceToken && destinationToken && sourceAmount > 0n && !insufficientBalance
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

  if (isBridging || isBridgeSuccess || isBridgeError) {
    const sourceDecimals = sourceToken?.decimals ?? 18;
    const rawSourceAmount =
      sourceToken && bridgeQuote?.estimate.fromAmount ? BigInt(bridgeQuote.estimate.fromAmount) : sourceAmount;

    const formattedSourceAmount: string = Number(formatUnits(rawSourceAmount, sourceDecimals)).toLocaleString(
      undefined,
      { maximumFractionDigits: Math.min(6, sourceDecimals) },
    );

    const formattedUsdValue: string = (
      Number(formatUnits(BigInt(bridgeQuote?.estimate.toAmountMin ?? 0), destinationToken?.decimals ?? 18)) *
      Number(destinationToken?.priceUSD ?? 0)
    ).toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      currencyDisplay: "narrowSymbol",
    });

    return (
      <GradientScrollView variant={isBridgeError ? "error" : isBridgeSuccess ? "success" : "neutral"}>
        <View flex={1}>
          <YStack gap="$s7" paddingBottom="$s9">
            <Pressable
              onPress={() => {
                if (!isBridging) {
                  setSourceAmount(0n);
                  resetBridgeMutation();
                }
                navigation.replace("(home)", { screen: "index" });
              }}
            >
              <X size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <YStack gap="$s4_5" justifyContent="center" alignItems="center">
              <Square
                size={80}
                borderRadius="$r4"
                backgroundColor={
                  isBridgeError
                    ? "$interactiveBaseErrorSoftDefault"
                    : isBridgeSuccess
                      ? "$interactiveBaseSuccessSoftDefault"
                      : "$backgroundStrong"
                }
              >
                {isBridging && <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />}
                {isBridgeSuccess && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
                {isBridgeError && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
              </Square>
              <Text secondary body>
                {isBridgeError
                  ? "Bridge failed"
                  : isBridgeSuccess
                    ? "Bridge transaction submitted"
                    : "Processing bridge"}
              </Text>
              <XStack gap="$s3" alignItems="center">
                {sourceToken && <TokenLogo token={sourceToken} size={32} />}
                <Text title primary color="$uiNeutralPrimary">
                  {`${formattedSourceAmount} ${sourceToken?.symbol ?? ""}`}
                </Text>
              </XStack>
              <Text emphasized secondary body textAlign="center">
                {formattedUsdValue}
              </Text>
            </YStack>
          </YStack>
        </View>
        {!isBridging && (
          <YStack flex={2} justifyContent="flex-end" gap="$s5" alignItems="center" paddingBottom="$s6">
            <Pressable
              onPress={() => {
                setSourceAmount(0n);
                resetBridgeMutation();
                navigation.replace("(home)", { screen: "index" });
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
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.replace("(home)", { screen: "index" });
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
                  subLabel={shortenHex(ownerAccount ?? zeroAddress, 4, 6)}
                  token={sourceToken}
                  amount={sourceAmount}
                  balance={sourceBalance}
                  isLoading={isPending}
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
                        Destination asset
                      </Text>
                      <Text footnote color="$uiNeutralSecondary">
                        Exa Account | {shortenHex(account ?? zeroAddress, 4, 6)}
                      </Text>
                    </YStack>
                  </XStack>
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
                              <AssetLogo
                                external
                                source={{ uri: destinationToken.logoURI }}
                                width={40}
                                height={40}
                                borderRadius="$r_0"
                              />
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
                            {!!account && sourceAmount > 0n && !insufficientBalance && isBridgeQuotePending ? (
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
                                {Number(
                                  formatUnits(BigInt(bridgeQuote?.estimate.toAmount ?? 0n), destinationToken.decimals),
                                ).toLocaleString(undefined, {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: destinationToken.decimals,
                                  useGrouping: false,
                                })}
                              </Text>
                            )}
                            <XStack justifyContent="space-between" alignItems="center" flex={1}>
                              {!!account && sourceAmount > 0n && !insufficientBalance && isBridgeQuotePending ? (
                                <Skeleton height={16} width={100} />
                              ) : (
                                <Text callout color="$uiNeutralPlaceholder">
                                  {`≈${Number(
                                    formatUnits(
                                      (BigInt(bridgeQuote?.estimate.toAmount ?? 0n) *
                                        parseUnits(destinationToken.priceUSD, 18)) /
                                        WAD,
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
                </YStack>
              )}
              {ownerAccount &&
                account &&
                sourceToken &&
                destinationToken &&
                !isBridgeQuotePending &&
                bridgeQuote &&
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
                    {bridgeQuote.estimate.executionDuration && (
                      <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
                        <Text caption color="$uiNeutralSecondary">
                          Estimated time
                        </Text>
                        <Text caption color="$uiNeutralPrimary" textAlign="right" flexShrink={1}>
                          {`~${Math.max(1, Math.round(bridgeQuote.estimate.executionDuration / 60))} min`}
                        </Text>
                      </XStack>
                    )}
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
              {bridgeQuoteError && ownerAccount && account && sourceAmount > 0n && !insufficientBalance && (
                <Text caption2 color="$interactiveOnBaseWarningSoft">
                  Unable to fetch a bridge quote right now. Please adjust the amount or try again later.
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
                <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3">
                  <View>
                    <Info size={16} width={16} height={16} color="$uiInfoSecondary" />
                  </View>
                  <XStack flex={1}>
                    <Text caption2 color="$uiNeutralPlaceholder">
                      {`You must confirm ${isAtomicSendCallsReady ? 1 : 2} transaction${isAtomicSendCallsReady ? "" : "s"} on your external wallet.`}
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
                if (!bridgeQuote) return;
                executeBridge(bridgeQuote).catch(reportError);
              }}
              disabled={isActionDisabled}
              loading={isBridging}
            >
              <Button.Text>{sourceToken ? `Bridge ${sourceToken.symbol}` : "Select source asset"}</Button.Text>
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
          enableNetworkFilter
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
