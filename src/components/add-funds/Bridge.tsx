import chain, { previewerAddress } from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import type { Chain, Token } from "@lifi/sdk";
import { ArrowLeft, CircleHelp, Repeat } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getCapabilities } from "@wagmi/core/actions";
import { useNavigation } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddress,
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
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
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
  const destinationToken = destinationTokens.find((token) => token.address === selectedDestinationAddress);
  const destinationBalances = useMemo(() => bridge?.balancesByChain[chain.id] ?? [], [bridge?.balancesByChain]);

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
        return { token, balance, usdValue };
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

  const { mutateAsync: executeBridge, isPending: isBridging } = useMutation<unknown, unknown, RouteFrom>({
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

      let shouldUseSendCalls = false;
      try {
        const capabilities = await getCapabilities(injectedConfig, {
          account: ownerAccount,
          connector: await getConnector(),
          chainId: quoteChainId,
        });
        shouldUseSendCalls = capabilities.atomic?.status === "ready";
      } catch {
        shouldUseSendCalls = false;
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
      setSourceAmount(0n);
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
            Bridge
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
              <Text emphasized callout>
                Bridge assets from&nbsp;
                <Text emphasized callout secondary>
                  {shortenHex(ownerAccount ?? zeroAddress, 8, 6)}
                </Text>
              </Text>
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
                  label="Select asset"
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
                <Pressable
                  onPress={() => {
                    if (destinationTokens.length > 0) setDestinationModalOpen(true);
                  }}
                  // eslint-disable-next-line react-native/no-inline-styles
                  style={{ flex: 1 }}
                >
                  <XStack
                    borderWidth={1}
                    borderColor={destinationModalOpen ? "$borderBrandStrong" : "$borderNeutralSoft"}
                    borderRadius="$r3"
                    padding="$s4_5"
                    gap="$s4"
                    flex={1}
                    alignItems="center"
                  >
                    <YStack gap="$s5" flex={1}>
                      <Text emphasized footnote color="$uiNeutralSecondary">
                        Destination asset
                      </Text>
                      <XStack gap="$s3_5" alignItems="center" justifyContent="space-between">
                        <XStack gap="$s3_5" alignItems="center" flex={1}>
                          <View width={40} height={40} position="relative">
                            <TokenLogo token={destinationToken} size={40} />
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
                          <YStack flex={1} gap="$s2">
                            <Text emphasized callout color="$uiNeutralPrimary" numberOfLines={1}>
                              {destinationToken.symbol}
                            </Text>
                            <Text footnote color="$uiNeutralSecondary" numberOfLines={1}>
                              {destinationToken.name}
                            </Text>
                          </YStack>
                        </XStack>
                        <XStack alignItems="center">
                          <Text footnote color="$uiBrandSecondary">
                            Change
                          </Text>
                        </XStack>
                      </XStack>
                    </YStack>
                  </XStack>
                </Pressable>
              )}
              {ownerAccount &&
                account &&
                sourceToken &&
                destinationToken &&
                !isBridgeQuotePending &&
                bridgeQuote &&
                sourceAmount > 0n &&
                !insufficientBalance && (
                  <YStack borderWidth={1} borderColor="$borderNeutralSoft" borderRadius="$r3" padding="$s4_5" gap="$s4">
                    <YStack gap="$s3">
                      <YStack gap="$s1">
                        <Text caption2 color="$uiNeutralSecondary">
                          You send
                        </Text>
                        <Text emphasized callout color="$uiNeutralPrimary">
                          {`${Number(formatUnits(sourceAmount, sourceToken.decimals)).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: sourceToken.decimals,
                            useGrouping: false,
                          })} ${sourceToken.symbol} ${
                            selectedGroup?.chain.name
                              ? ` · ${selectedGroup.chain.name}`
                              : selectedSource?.chain
                                ? ` · Chain ${selectedSource.chain}`
                                : ""
                          }`}
                        </Text>
                      </YStack>
                      <YStack gap="$s1">
                        <Text caption2 color="$uiNeutralSecondary">
                          Estimated arrival
                        </Text>
                        <Text emphasized callout color="$uiNeutralPrimary">
                          {`≈ ${Number(
                            formatUnits(BigInt(bridgeQuote.estimate.toAmount), destinationToken.decimals),
                          ).toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: destinationToken.decimals,
                            useGrouping: false,
                          })} ${destinationToken.symbol}`}
                        </Text>
                      </YStack>
                      {bridgeQuote.estimate.toAmountMin && (
                        <YStack gap="$s1">
                          <Text caption2 color="$uiNeutralSecondary">
                            Minimum received
                          </Text>
                          <Text emphasized callout color="$uiNeutralPrimary">
                            {`${Number(
                              formatUnits(BigInt(bridgeQuote.estimate.toAmountMin), destinationToken.decimals),
                            ).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: destinationToken.decimals,
                              useGrouping: false,
                            })} ${destinationToken.symbol}`}
                          </Text>
                        </YStack>
                      )}
                      {bridgeQuote.estimate.executionDuration && (
                        <YStack gap="$s1">
                          <Text caption2 color="$uiNeutralSecondary">
                            Estimated time
                          </Text>
                          <Text emphasized callout color="$uiNeutralPrimary">
                            {`~${Math.max(1, Math.round(bridgeQuote.estimate.executionDuration / 60))} min`}
                          </Text>
                        </YStack>
                      )}
                      {bridgeQuote.estimate.approvalAddress && (
                        <YStack gap="$s1">
                          <Text emphasized caption2 color="$interactiveOnBaseWarningSoft">
                            Approval may be required before bridging.
                          </Text>
                        </YStack>
                      )}
                    </YStack>
                  </YStack>
                )}
              {statusMessage && (
                <XStack gap="$s3" alignItems="center">
                  <Spinner color="$interactiveOnBaseBrandDefault" size="small" />
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
          <YStack gap="$s4">
            <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
              Bridge routes are provided via&nbsp;
              <Text
                caption2
                color="$interactiveOnDisabled"
                textDecorationLine="underline"
                onPress={() => {
                  openBrowser("https://li.fi/").catch(reportError);
                }}
              >
                LI.FI
              </Text>
              ; availability, pricing, and execution remain subject to third-party protocols and network conditions.
            </Text>
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
