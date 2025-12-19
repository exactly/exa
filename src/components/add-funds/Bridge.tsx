import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { Chain, Token } from "@lifi/sdk";
import { ArrowLeft, CircleHelp, Clock, Repeat } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";
import { erc20Abi, getAddress, zeroAddress } from "viem";
import { useSimulateContract } from "wagmi";

import AssetSelectSheet from "./AssetSelectSheet";
import BridgeProcessing from "./BridgeProcessing";
import DestinationCard from "./DestinationCard";
import QuoteDetails from "./QuoteDetails";
import { getRouteFrom, tokenCorrelation, type RouteFrom } from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useBridgeData from "../../utils/useBridgeData";
import useBridgeTransaction from "../../utils/useBridgeTransaction";
import ownerConfig from "../../utils/wagmi/owner";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";
import TokenInput from "../swaps/TokenInput";

export default function Bridge() {
  const router = useRouter();

  const [assetSheetOpen, setAssetSheetOpen] = useState(false);
  const [destinationModalOpen, setDestinationModalOpen] = useState(false);

  const [userSelectedSource, setUserSelectedSource] = useState<{ chain: number; address: string } | undefined>();
  const [userSelectedDestinationAddress, setUserSelectedDestinationAddress] = useState<string | undefined>();

  const [sourceAmount, setSourceAmount] = useState<bigint>(0n);

  const senderConfig = ownerConfig;
  const { address: senderAddress } = useAccount({ config: senderConfig });
  const { address: account } = useAccount();

  const {
    bridge,
    assetGroups,
    destinationTokens,
    destinationBalances,
    protocolSymbols,
    isPending: isSourcesPending,
  } = useBridgeData(senderAddress);

  const defaultSource = useMemo(() => {
    if (assetGroups.length === 0) return;
    const defaultChainId = bridge?.defaultChainId;
    const defaultTokenAddress = bridge?.defaultTokenAddress;
    const defaultGroup =
      defaultChainId && defaultTokenAddress ? assetGroups.find((g) => g.chain.id === defaultChainId) : undefined;
    const defaultAsset = defaultGroup?.assets.find((a) => a.token.address === defaultTokenAddress);
    const resolvedGroup = defaultAsset ? defaultGroup : assetGroups[0];
    const fallbackAsset = defaultAsset ?? assetGroups[0]?.assets[0];
    if (!resolvedGroup || !fallbackAsset) return;
    return { chain: resolvedGroup.chain.id, address: fallbackAsset.token.address };
  }, [assetGroups, bridge?.defaultChainId, bridge?.defaultTokenAddress]);

  const activeSource = userSelectedSource ?? defaultSource;

  const selectedGroup = assetGroups.find((group) => group.chain.id === activeSource?.chain);
  const selectedAsset = selectedGroup?.assets.find((asset) => asset.token.address === activeSource?.address);
  const sourceToken = selectedAsset?.token;
  const sourceBalance = selectedAsset?.balance ?? 0n;

  const activeDestinationAddress = useMemo(() => {
    if (userSelectedDestinationAddress) return userSelectedDestinationAddress;
    if (!sourceToken) return;
    const sourceSymbol = sourceToken.symbol;
    const correlatedSymbol = sourceSymbol && tokenCorrelation[sourceSymbol as keyof typeof tokenCorrelation];
    const correlatedToken = correlatedSymbol ? destinationTokens.find((t) => t.symbol === correlatedSymbol) : undefined;
    const defaultDestination = correlatedToken ?? destinationTokens.find((t) => t.symbol === "USDC");
    return defaultDestination?.address;
  }, [userSelectedDestinationAddress, sourceToken, destinationTokens]);

  const destinationToken = destinationTokens.find((token) => token.address === activeDestinationAddress);
  const destinationBalance = destinationToken
    ? (destinationBalances.find((item) => item.address === destinationToken.address)?.amount ?? 0n)
    : 0n;

  const insufficientBalance = sourceAmount > sourceBalance;
  const isSameChain = activeSource?.chain === chain.id;
  const isNativeSource = activeSource?.address === zeroAddress;

  const destinationAssetGroups = useMemo(() => {
    if (destinationTokens.length === 0) return [];
    const assets = destinationTokens
      .filter((token) => token.logoURI && protocolSymbols.includes(token.symbol))
      .map((token) => ({
        token: token.symbol === "wstETH" ? { ...token, name: "Wrapped Staked ETH" } : token,
        balance: destinationBalances.find((item) => item.address === token.address)?.amount ?? 0n,
        usdValue: 0,
      }));
    return [{ chain: { id: chain.id, name: chain.name, logoURI: undefined } as Chain, assets }];
  }, [destinationTokens, destinationBalances, protocolSymbols]);

  const bridgeQuoteEnabled =
    !!senderAddress &&
    !!account &&
    !!activeSource &&
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
      activeSource,
      destinationToken,
      sourceAmount,
      isSameChain,
      sourceToken,
      sourceToken?.address,
    ],
    queryFn: () => {
      if (!senderAddress || !account || !activeSource || !sourceToken || !destinationToken)
        throw new Error("Invalid params");
      return getRouteFrom({
        fromChainId: activeSource.chain,
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
    !!activeSource.address &&
    sourceAmount > 0n &&
    !insufficientBalance;

  const { data: transferSimulation, isLoading: isSimulatingTransfer } = useSimulateContract({
    config: senderConfig,
    chainId: transferSimulationEnabled ? activeSource.chain : undefined,
    address: transferSimulationEnabled ? getAddress(activeSource.address) : undefined,
    abi: erc20Abi,
    functionName: "transfer",
    args: transferSimulationEnabled ? ([getAddress(account), sourceAmount] as const) : undefined,
    query: { enabled: transferSimulationEnabled },
  });

  const {
    executeBridge,
    executeTransfer,
    status,
    preview,
    setPreview,
    isPending: isTxPending,
    isSuccess: isTxSuccess,
    isError: isTxError,
    reset: resetTx,
  } = useBridgeTransaction({ senderAddress, senderConfig, account, selectedSource: activeSource });

  const handleSelectSource = (chainId: number, token: Token) => {
    setSourceAmount(0n);
    setUserSelectedSource({ chain: chainId, address: token.address });
    const correlatedSymbol = token.symbol && tokenCorrelation[token.symbol as keyof typeof tokenCorrelation];
    const correlatedToken = correlatedSymbol ? destinationTokens.find((t) => t.symbol === correlatedSymbol) : undefined;
    const defaultDestination = correlatedToken ?? destinationTokens.find((t) => t.symbol === "USDC");
    setUserSelectedDestinationAddress(defaultDestination?.address);
  };

  const isLoadingAssets = isSourcesPending && !bridge;
  const isProcessing = !!preview && (isTxPending || isTxSuccess || isTxError);

  const isActionDisabled =
    isSourcesPending ||
    isLoadingAssets ||
    isBridgeQuoteFetching ||
    isTxPending ||
    isSimulatingTransfer ||
    !sourceToken ||
    !destinationToken ||
    sourceAmount === 0n ||
    insufficientBalance ||
    (!isSameChain && !bridgeQuote);

  const statusMessage = useMemo(
    () =>
      isTxPending
        ? !!status
        : isSameChain && isSimulatingTransfer
          ? "Simulating transfer..."
          : isBridgeQuoteFetching
            ? "Fetching best route..."
            : undefined,
    [isTxPending, status, isSimulatingTransfer, isBridgeQuoteFetching],
  );

  if (isProcessing) {
    return (
      <BridgeProcessing
        status={status}
        isError={isTxError}
        isSuccess={isTxSuccess}
        isPending={isTxPending}
        preview={preview}
        onClose={() => {
          if (isTxPending) return;
          setSourceAmount(0n);
          resetTx();
          if (isTxSuccess) router.replace("/(main)/(home)");
        }}
      />
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
              if (router.canGoBack()) router.back();
              else router.replace("/(main)/(home)");
            }}
          >
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <Text primary emphasized subHeadline>
            Add funds
          </Text>
          <Pressable
            onPress={() => {
              openBrowser("https://li.fi/").catch(reportError);
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
                  onChange={setSourceAmount}
                  onUseMax={setSourceAmount}
                  chainLogoUri={selectedGroup?.chain.id === 10 ? undefined : selectedGroup?.chain.logoURI}
                />
              )}
              {insufficientBalance && (
                <Text caption2 color="$interactiveOnBaseWarningSoft">
                  Amount exceeds available balance.
                </Text>
              )}

              {destinationToken && (
                <DestinationCard
                  token={destinationToken}
                  balance={destinationBalance}
                  toAmount={toAmount}
                  account={account ?? zeroAddress}
                  isSameChain={isSameChain}
                  isLoadingQuote={!!account && sourceAmount > 0n && !insufficientBalance && isBridgeQuoteFetching}
                  canSelect={destinationTokens.length > 0}
                  onPress={() => setDestinationModalOpen(true)}
                  destinationModalOpen={destinationModalOpen}
                />
              )}

              {senderAddress &&
                account &&
                sourceToken &&
                destinationToken &&
                !isBridgeQuoteFetching &&
                bridgeQuote &&
                sourceAmount > 0n &&
                !insufficientBalance && (
                  <QuoteDetails
                    quote={bridgeQuote}
                    sourceToken={sourceToken}
                    destinationToken={destinationToken}
                    sourceAmount={sourceAmount}
                    sourceChainName={selectedGroup?.chain.name ?? `Chain ${activeSource?.chain}`}
                    destinationChainName={chain.name}
                  />
                )}

              {statusMessage && (
                <XStack gap="$s3" alignItems="center">
                  <Spinner color="$uiBrandSecondary" size="small" />
                  <Text footnote color="$uiNeutralSecondary">
                    {statusMessage}
                  </Text>
                </XStack>
              )}
              {bridgeQuoteError &&
                !isBridgeQuoteFetching &&
                sourceAmount > 0n &&
                !insufficientBalance &&
                !isSameChain && (
                  <Text caption2 color="$interactiveOnBaseWarningSoft">
                    Unable to fetch a bridge quote right now.
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
              <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3">
                <Clock size={16} color="$uiInfoSecondary" />
                <Text caption2 color="$uiNeutralPlaceholder" flex={1}>
                  Bridging assets may take up to 10 minutes.
                </Text>
              </XStack>
            )}
            <Button
              primary
              width="100%"
              alignItems="center"
              disabled={isActionDisabled}
              loading={isTxPending}
              onPress={() => {
                if (!sourceToken) return;
                setPreview({
                  sourceToken,
                  sourceAmount: isSameChain ? sourceAmount : BigInt(bridgeQuote?.estimate.fromAmount ?? 0n),
                });

                if (isSameChain) {
                  executeTransfer({
                    amount: sourceAmount,
                    request: transferSimulation?.request,
                    isNative: isNativeSource,
                  }).catch(reportError);
                } else if (bridgeQuote) {
                  executeBridge(bridgeQuote).catch(reportError);
                }
              }}
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
          onClose={() => setAssetSheetOpen(false)}
          groups={assetGroups}
          selected={activeSource}
          onSelect={handleSelectSource}
        />

        <AssetSelectSheet
          hideBalances
          label="Select asset to receive"
          open={destinationModalOpen}
          onClose={() => setDestinationModalOpen(false)}
          groups={destinationAssetGroups}
          selected={destinationToken ? { chain: chain.id, address: destinationToken.address } : undefined}
          onSelect={(_, token) => {
            setUserSelectedDestinationAddress(token.address);
            setDestinationModalOpen(false);
          }}
        />
      </View>
    </SafeView>
  );
}
