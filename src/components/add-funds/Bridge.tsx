import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Credential } from "@exactly/common/validation";
import type { Chain, Token } from "@lifi/sdk";
import { ArrowLeft, CircleHelp, Repeat } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getPublicClient, sendTransaction } from "@wagmi/core/actions";
import { useNavigation } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  isAddress,
  type Address,
  UserRejectedRequestError,
  zeroAddress,
} from "viem";
import { optimism } from "viem/chains";
import { useAccount } from "wagmi";

import AssetSelectSheet from "./AssetSelectSheet";
import TokenAvatar from "./TokenAvatar";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import OptimismImage from "../../assets/images/optimism.svg";
import { config as injectedConfig, connectAccount, getConnector } from "../../utils/injectedConnector";
import { getBridgeQuote, getBridgeSources, type BridgeQuote, type BridgeSourcesData } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useOpenBrowser from "../../utils/useOpenBrowser";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";
import TokenInput from "../swaps/TokenInput";

export default function Bridge() {
  const navigation = useNavigation<AppNavigationProperties>();
  const openBrowser = useOpenBrowser();
  const toast = useToastController();
  const { address: account } = useAccount();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const ownerAccount = credential && isAddress(credential.credentialId) ? credential.credentialId : undefined;

  const { data: bridge, isPending } = useQuery<BridgeSourcesData>({
    queryKey: ["bridge", "sources", ownerAccount],
    queryFn: () => getBridgeSources(ownerAccount ?? undefined),
    staleTime: 30_000,
    enabled: !!ownerAccount,
  });

  const chains = bridge?.chains;
  const ownerAssetsByChain = bridge?.ownerAssetsByChain;

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

  const [selectedSource, setSelectedSource] = useState<{ chain: number; address: string } | undefined>();
  const [sourceAmount, setSourceAmount] = useState<bigint>(0n);
  const [assetSheetOpen, setAssetSheetOpen] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<string | undefined>();

  const selectedGroup = assetGroups.find((group) => group.chain.id === selectedSource?.chain);
  const selectedAsset = selectedGroup?.assets.find((asset) => asset.token.address === selectedSource?.address);

  const sourceToken = selectedAsset?.token;
  const sourceBalance = selectedAsset?.balance ?? 0n;
  const insufficientBalance = sourceAmount > sourceBalance;

  const destinationTokens = bridge?.tokensByChain[optimism.id] ?? [];
  const destinationToken = sourceToken
    ? destinationTokens.find((token) => token.symbol === sourceToken.symbol && token.logoURI)
    : undefined;

  const {
    data: bridgeQuote,
    error: bridgeQuoteError,
    isPending: isBridgeQuotePending,
  } = useQuery<BridgeQuote>({
    queryKey: [
      "bridge",
      "quote",
      ownerAccount,
      account,
      selectedSource?.chain,
      selectedSource?.address,
      destinationToken?.address,
      selectedSource,
      sourceToken,
      destinationToken,
      sourceAmount,
      sourceToken?.address,
    ],
    queryFn: () => {
      if (!ownerAccount || !account || !selectedSource || !sourceToken || !destinationToken || sourceAmount === 0n)
        throw new Error("invalid bridge parameters");
      return getBridgeQuote({
        fromChainId: selectedSource.chain,
        toChainId: optimism.id,
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
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const { mutateAsync: executeBridge, isPending: isBridging } = useMutation<unknown, unknown, BridgeQuote>({
    mutationKey: ["bridge", "execute"],
    mutationFn: async (quote: BridgeQuote) => {
      if (!ownerAccount || !selectedSource) throw new Error("missing bridge context");
      setBridgeStatus("Connecting wallet...");
      await connectAccount(ownerAccount);
      const connector = await getConnector();
      setBridgeStatus(`Switching to ${selectedGroup?.chain.name ?? `Chain ${quote.chainId}`}...`);
      await connector.switchChain?.({ chainId: quote.chainId });
      const publicClient = getPublicClient(injectedConfig, { chainId: quote.chainId as 10 | 8453 }); // TODO replace this with the proper chain id
      const approvalAddress = quote.estimate.approvalAddress;
      const requiresApproval =
        !!approvalAddress &&
        approvalAddress !== zeroAddress &&
        selectedSource.address !== zeroAddress &&
        isAddress(approvalAddress) &&
        isAddress(selectedSource.address);

      if (requiresApproval) {
        setBridgeStatus("Checking allowance...");
        const tokenAddress = selectedSource.address as Address;
        const spender = approvalAddress;
        let allowance = 0n;
        try {
          allowance = await publicClient.readContract({
            abi: erc20Abi,
            address: tokenAddress,
            functionName: "allowance",
            args: [ownerAccount, spender],
          });
        } catch {
          allowance = 0n;
        }

        const requiredAllowance = (() => {
          try {
            return BigInt(quote.estimate.fromAmount);
          } catch {
            return sourceAmount;
          }
        })();

        if (allowance < requiredAllowance) {
          const symbol = sourceToken?.symbol ?? "token";
          setBridgeStatus(`Submitting ${symbol} approval...`);
          await sendTransaction(injectedConfig, {
            connector,
            account: ownerAccount,
            chainId: quote.chainId as 10 | 8453,
            to: tokenAddress,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, requiredAllowance] }),
            value: 0n,
          });
          setBridgeStatus("Approval transaction sent...");
        }
      }
      setBridgeStatus("Submitting bridge transaction...");
      const hash = await sendTransaction(injectedConfig, {
        connector,
        account: ownerAccount,
        ...quote,
        chainId: quote.chainId as 10 | 8453,
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

    const selectionStillValid =
      !!selectedSource &&
      assetGroups.some(
        (group) =>
          group.chain.id === selectedSource.chain &&
          group.assets.some((asset) => asset.token.address === selectedSource.address),
      );

    if (selectionStillValid) return;

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
                  chainLogoUri={selectedGroup?.chain.logoURI}
                />
              )}
              {insufficientBalance && (
                <Text caption2 color="$interactiveOnBaseWarningSoft">
                  Amount exceeds available balance.
                </Text>
              )}
              <View borderWidth={1} borderColor="$borderNeutralSoft" borderRadius="$r3" padding="$s4_5" gap="$s4">
                <XStack gap="$s4" justifyContent="space-between">
                  {destinationToken && (
                    <YStack gap="$s4">
                      <Text emphasized footnote secondary>
                        Destination asset
                      </Text>
                      <XStack gap="$s3_5" alignItems="center">
                        <TokenAvatar token={destinationToken} />
                        <YStack>
                          <Text emphasized callout color="$uiNeutralPrimary">
                            {destinationToken.symbol}
                          </Text>
                          <Text footnote color="$uiNeutralSecondary">
                            {destinationToken.name}
                          </Text>
                        </YStack>
                      </XStack>
                    </YStack>
                  )}
                  <YStack gap="$s4">
                    <Text emphasized footnote secondary>
                      Destination chain
                    </Text>
                    <XStack gap="$s3_5" alignItems="center">
                      <OptimismImage height={32} width={32} />
                      <Text emphasized callout color="$uiNeutralPrimary">
                        {chain.name}
                      </Text>
                    </XStack>
                  </YStack>
                </XStack>
              </View>
              {statusMessage && (
                <XStack gap="$s3" alignItems="center">
                  <Spinner color="$interactiveOnBaseBrandDefault" size="small" />
                  <Text footnote color="$uiNeutralSecondary">
                    {statusMessage}
                  </Text>
                </XStack>
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
                            maximumFractionDigits: Math.min(
                              8,
                              Math.max(
                                0,
                                sourceToken.decimals - Math.ceil(Math.log10(Math.max(1, Number(sourceAmount) / 1e18))),
                              ),
                            ),
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
                            maximumFractionDigits: Math.min(
                              8,
                              Math.max(
                                0,
                                destinationToken.decimals -
                                  Math.ceil(Math.log10(Math.max(1, Number(bridgeQuote.estimate.toAmount) / 1e18))),
                              ),
                            ),
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
                              maximumFractionDigits: Math.min(
                                8,
                                Math.max(
                                  0,
                                  destinationToken.decimals -
                                    Math.ceil(Math.log10(Math.max(1, Number(bridgeQuote.estimate.toAmountMin) / 1e18))),
                                ),
                              ),
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
      </View>
    </SafeView>
  );
}
