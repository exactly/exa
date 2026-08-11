import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Check, Coins, FilePen, X } from "@tamagui/lucide-icons";
import { Avatar, ScrollView, Square, XStack, YStack } from "tamagui";

import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { bigint, check, parse, pipe, safeParse } from "valibot";
import {
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  getAddress,
  parseUnits,
  zeroAddress as viemZeroAddress,
} from "viem";
import { useEstimateGas, useSendCalls, useSimulateContract } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, { exaPluginAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import { Address, type Credential } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import ReviewSheet from "./ReviewSheet";
import { getRouteFrom, statusOptions } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useSimulateProposal from "../../utils/useSimulateProposal";
import exa from "../../utils/wagmi/exa";
import AmountSelector from "../shared/AmountSelector";
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

export default function Amount() {
  const router = useRouter();
  const { address } = useAccount();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [reviewOpen, setReviewOpen] = useState(false);

  const { asset: assetAddress, receiver: receiverAddress, amount, toChain, toToken } = useLocalSearchParams();
  const withdrawAssetParse = safeParse(Address, assetAddress);
  const withdrawReceiverParse = safeParse(Address, receiverAddress);
  const zeroAddress = parse(Address, viemZeroAddress);
  const withdrawAsset = withdrawAssetParse.success ? withdrawAssetParse.output : undefined;
  const receiver = typeof receiverAddress === "string" ? receiverAddress : "";
  const receiverHex = withdrawReceiverParse.success ? withdrawReceiverParse.output : undefined;
  const destinationChain = typeof toChain === "string" ? Number(toChain) : chain.id;
  const destinationToken = typeof toToken === "string" ? toToken : undefined;

  const { market, externalAsset: external, available, isFetching, markets } = useAsset(withdrawAsset ?? zeroAddress);
  const assetIn = market?.asset ?? external?.address;
  const routed =
    !!destinationToken && (destinationChain !== chain.id || destinationToken.toLowerCase() !== assetIn?.toLowerCase());

  const form = useForm({ defaultValues: { amount: typeof amount === "string" ? BigInt(amount) : 0n } });
  const formAmount = useStore(form.store, (state) => state.values.amount);

  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!address && !!credential },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  const { request: proposeSimulation } = useSimulateProposal({
    account: address,
    amount: formAmount,
    market: market?.market,
    proposalType: ProposalType.Withdraw,
    receiver: receiverHex,
    enabled: !routed && !!market && !!address && formAmount > 0n && !!receiverHex && receiverHex !== zeroAddress,
  });

  const {
    data: route,
    error: routeError,
    isFetching: isRouteFetching,
  } = useQuery({
    queryKey: [
      "lifi",
      "route",
      "send",
      address,
      assetIn,
      destinationChain,
      destinationToken,
      receiver,
      String(formAmount),
    ],
    queryFn: () => {
      if (!address || !assetIn || !destinationToken) throw new Error("missing route parameters");
      return getRouteFrom({
        fromChainId: chain.id,
        toChainId: destinationChain,
        fromTokenAddress: assetIn,
        toTokenAddress: destinationToken,
        fromAmount: formAmount,
        fromAddress: address,
        toAddress: receiver,
      });
    },
    enabled: routed && !!address && !!assetIn && !!destinationToken && formAmount > 0n,
    refetchInterval: 20_000,
    retry: false,
    meta: { warnError: () => true },
  });

  const neutralAsset = useMemo(() => {
    const { success, output } = safeParse(
      Address,
      markets?.find(({ asset }) => asset.toLowerCase() !== assetIn?.toLowerCase())?.asset,
    );
    return success ? output : undefined;
  }, [markets, assetIn]);

  const { request: bridgePropose, error: bridgeProposeError } = useSimulateProposal({
    account: address,
    amount: formAmount,
    market: market?.market,
    proposalType: ProposalType.Swap,
    assetOut: neutralAsset,
    minAmountOut: 0n,
    route: route?.data,
    enabled: routed && !!market && !!address && !!route && !!neutralAsset && formAmount > 0n,
  });

  const externalAddress = useMemo(() => {
    const { success, output } = safeParse(Address, external?.address);
    return success ? output : zeroAddress;
  }, [external?.address, zeroAddress]);

  const isNativeTransfer = !!external && externalAddress === zeroAddress;

  const { data: erc20TransferSimulation } = useSimulateContract({
    address: externalAddress,
    chainId: chain.id,
    abi: erc20Abi,
    functionName: "transfer",
    args: receiverHex ? [receiverHex, formAmount] : undefined,
    query: {
      enabled:
        !routed &&
        !!external &&
        !isNativeTransfer &&
        !!address &&
        formAmount > 0n &&
        !!receiverHex &&
        receiverHex !== zeroAddress,
    },
  });

  const { data: nativeTransferEstimate } = useEstimateGas({
    chainId: chain.id,
    to: receiverHex,
    value: formAmount,
    query: {
      enabled:
        !routed &&
        !!external &&
        isNativeTransfer &&
        !!address &&
        formAmount > 0n &&
        !!receiverHex &&
        receiverHex !== zeroAddress,
    },
  });

  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const sendCalls = async (calls: readonly { data?: `0x${string}`; to: `0x${string}`; value?: bigint }[]) => {
    const { id } = await mutateSendCalls({
      chainId: chain.id,
      calls,
      capabilities: {
        paymasterService: {
          url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
          context: { policyId: alchemyGasPolicyId },
        },
      },
    });
    const result = await waitForCallsStatus(exa, { id });
    if (result.status === "failure") throw new Error("failed to send");
    return result.receipts?.[0]?.transactionHash;
  };
  const {
    mutate: send,
    data: hash,
    isPending: pending,
    isSuccess: success,
    isError: sendError,
    reset,
  } = useMutation({
    async mutationFn() {
      if (!sendReady || !receiver) throw new Error("not ready");
      if (routed) {
        if (!route || !assetIn) throw new Error("no route ready");
        if (bridgePropose) {
          const { address: to, abi, functionName, args } = bridgePropose;
          return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
        }
        return sendCalls([
          ...(isNativeTransfer
            ? []
            : [
                {
                  to: getAddress(assetIn),
                  data: encodeFunctionData({
                    abi: erc20Abi,
                    functionName: "approve",
                    args: [getAddress(route.estimate.approvalAddress), BigInt(route.estimate.fromAmount)],
                  }),
                },
              ]),
          { to: route.to, data: route.data, value: route.value },
        ]);
      }
      if (proposeSimulation) {
        const { address: to, abi, functionName, args } = proposeSimulation;
        return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
      }
      if (isNativeTransfer && receiverHex) return sendCalls([{ to: receiverHex, value: formAmount }]);
      if (erc20TransferSimulation) {
        const { address: to, abi, functionName, args } = erc20TransferSimulation.request;
        return sendCalls([{ to, data: encodeFunctionData({ abi, functionName, args }) }]);
      }
      throw new Error("no simulation ready");
    },
    onError(error) {
      if (reportError(error).authKnown) reset();
    },
  });

  const sendReady = useMemo(() => {
    if (formAmount <= 0n) return false;
    if (routed) return !!route && (market ? !!bridgePropose : !!assetIn);
    return market
      ? !!proposeSimulation
      : !!external && (isNativeTransfer ? !!nativeTransferEstimate : !!erc20TransferSimulation);
  }, [
    assetIn,
    bridgePropose,
    external,
    formAmount,
    isNativeTransfer,
    market,
    nativeTransferEstimate,
    proposeSimulation,
    route,
    routed,
    erc20TransferSimulation,
  ]);

  const { data: routeStatus } = useQuery(statusOptions(routed ? hash : undefined, destinationChain, route?.tool));

  const details: {
    amount: string;
    external: boolean;
    symbol?: string;
    usdValue: string;
  } = useMemo(() => {
    if (market) {
      const symbol = market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3);
      return {
        amount: formatUnits(formAmount, market.decimals),
        external: false,
        symbol,
        usdValue: formatUnits((formAmount * market.usdPrice) / WAD, market.decimals),
      };
    }
    return {
      amount: formatUnits(formAmount, external?.decimals ?? 0),
      external: true,
      symbol: external?.symbol,
      usdValue: formatUnits((formAmount * parseUnits(external?.priceUSD ?? "0", 18)) / WAD, external?.decimals ?? 0),
    };
  }, [external, market, formAmount]);

  const { data: recentContacts } = useQuery<undefined | { address: Address; ens: string }[]>({
    queryKey: ["contacts", "recent"],
  });

  const isFirstSend = !recentContacts?.some((contact) => contact.address === receiver);

  useEffect(() => {
    if (success && receiverHex && !recentContacts?.some((contact) => contact.address === receiverHex)) {
      queryClient.setQueryData<undefined | { address: Address; ens: string }[]>(["contacts", "recent"], (old) =>
        [{ address: receiverHex, ens: "" }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [success, receiverHex, recentContacts]);

  const invalidReceiver = !receiver || receiverHex === zeroAddress;
  const invalidAsset = !withdrawAsset;
  if (invalidReceiver || invalidAsset) {
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
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/send-funds/asset");
              }
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
          <View flexDirection="row" gap="$s3_5" justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <IconButton
                icon={ArrowLeft}
                aria-label={t("Back")}
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/send-funds/asset");
                  }
                }}
              />
            </View>
            <Text color="$uiNeutralPrimary" fontSize={15} fontWeight="bold">
              {t("Enter amount")}
            </Text>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }} gap="$s5">
            <View flex={1} gap="$s5" paddingBottom="$s5">
              <View gap="$s3">
                <XStack
                  alignItems="center"
                  backgroundColor="$backgroundBrandSoft"
                  borderRadius="$r2"
                  justifyContent="space-between"
                >
                  <XStack alignItems="center" gap="$s3" padding="$s3">
                    <View borderRadius="$r_0" overflow="hidden">
                      <Blocky seed={receiver} />
                    </View>
                    <Text emphasized callout color="$uiNeutralSecondary">
                      {t("To:")}
                    </Text>
                    <Text callout color="$uiNeutralPrimary" mono>
                      {shortenHex(receiver)}
                    </Text>
                  </XStack>
                </XStack>
                <XStack
                  alignItems="center"
                  backgroundColor="$backgroundBrandSoft"
                  borderRadius="$r2"
                  justifyContent="space-between"
                  gap="$s3"
                >
                  {isFetching ? (
                    <Skeleton width="100%" height={45} />
                  ) : (
                    <XStack alignItems="center" gap="$s3" padding="$s3">
                      <Avatar size={32} backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r_0">
                        <Coins size={20} color="$interactiveOnBaseBrandDefault" />
                      </Avatar>
                      <Text callout color="$uiNeutralSecondary">
                        {t("Available:")}
                      </Text>
                      <Text callout color="$uiNeutralPrimary" numberOfLines={1}>
                        {market ? (
                          <>
                            {`${(Number(available) / 10 ** market.decimals).toLocaleString(language, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: market.decimals,
                            })} ${market.symbol.slice(3)}`}
                          </>
                        ) : external ? (
                          <>
                            {`${(Number(available) / 10 ** external.decimals).toLocaleString(language, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: external.decimals,
                            })} ${external.symbol}`}
                          </>
                        ) : null}
                      </Text>
                    </XStack>
                  )}
                </XStack>
                {routed && (
                  <YStack gap="$s2" padding="$s3" borderRadius="$r2" backgroundColor="$backgroundMild">
                    <Text caption mono color="$uiNeutralPlaceholder">
                      {`in  ${assetIn ?? "?"} @ ${chain.id}\nout ${destinationToken} @ ${destinationChain}\nvia ${market ? `swap proposal · assetOut ${neutralAsset ?? "?"} · minAmountOut 0` : "approve + call"}`}
                    </Text>
                    <Text caption mono color="$uiNeutralPlaceholder">
                      {route
                        ? `tool ${route.tool ?? "?"} · out ${route.toAmount} · min ${route.estimate.toAmountMin} · ~${route.estimate.executionDuration}s · value ${route.value}`
                        : isRouteFetching
                          ? "quoting…"
                          : "no route"}
                    </Text>
                    {!!routeError && (
                      <Text caption mono color="$uiErrorSecondary">
                        {`quote: ${reason(routeError)}`}
                      </Text>
                    )}
                    {!!bridgeProposeError && (
                      <Text caption mono color="$uiErrorSecondary">
                        {`simulation: ${reason(bridgeProposeError)}`}
                      </Text>
                    )}
                  </YStack>
                )}
              </View>
              <form.Field
                name="amount"
                validators={{
                  onChange: pipe(
                    bigint(),
                    check((value) => {
                      return value !== 0n;
                    }, t("Amount cannot be zero")),
                    check((value) => {
                      return value <= available;
                    }, t("Amount cannot be greater than available")),
                  ),
                }}
              >
                {({ state: { meta }, handleChange }) => (
                  <>
                    <AmountSelector onChange={handleChange} />
                    {meta.errors.length > 0 ? (
                      <Text padding="$s3" footnote color="$uiNeutralSecondary">
                        {meta.errors[0]?.message.split(",")[0]}
                      </Text>
                    ) : undefined}
                  </>
                )}
              </form.Field>
            </View>
            <form.Subscribe selector={({ isValid, isTouched }) => [isValid, isTouched]}>
              {([isValid, isTouched]) => {
                return (
                  <Button
                    primary
                    disabled={!isValid || !isTouched}
                    onPress={() => {
                      setReviewOpen(true);
                    }}
                  >
                    <Button.Text>{t("Review")}</Button.Text>
                    <Button.Icon>
                      <FilePen size={24} />
                    </Button.Icon>
                  </Button>
                );
              }}
            </form.Subscribe>
          </ScrollView>
        </View>
        <ReviewSheet
          amount={details.amount}
          isFirstSend={isFirstSend}
          onClose={() => {
            setReviewOpen(false);
          }}
          onSend={() => {
            setReviewOpen(false);
            send();
          }}
          open={reviewOpen}
          receiver={receiver}
          sendReady={sendReady}
          symbol={details.symbol}
          usdValue={details.usdValue}
        />
      </SafeView>
    );
  }

  return (
    <GradientScrollView variant={sendError ? "error" : success ? (isLatestPlugin ? "info" : "success") : "neutral"}>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <IconButton
            alignSelf="flex-start"
            icon={X}
            aria-label={t("Close")}
            onPress={() => {
              router.dismissTo("/activity");
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
                    ? isLatestPlugin
                      ? "$interactiveBaseInformationSoftDefault"
                      : "$interactiveBaseSuccessSoftDefault"
                    : "$backgroundStrong"
              }
            >
              {pending && <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />}
              {success && isLatestPlugin && <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />}
              {success && !isLatestPlugin && <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />}
              {sendError && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              {pending && (
                <>
                  {t("Sending to")}{" "}
                  <Text emphasized primary body color="$uiNeutralPrimary">
                    {shortenHex(receiver, 5, 7)}
                  </Text>
                </>
              )}
              {success && (
                <>
                  {t(isLatestPlugin ? "Processing" : "Paid")}{" "}
                  <Text emphasized primary body color="$uiNeutralPrimary">
                    {t("Withdrawal")}
                  </Text>
                </>
              )}
              {sendError && (
                <>
                  {t("Failed")}{" "}
                  <Text emphasized primary body color="$uiNeutralPrimary">
                    {shortenHex(receiver, 3, 5)}
                  </Text>
                </>
              )}
            </Text>
            <Text title primary color="$uiNeutralPrimary">
              {`$${Number(details.usdValue).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            </Text>
            <XStack gap="$s2" alignItems="center">
              <Text emphasized secondary subHeadline>
                {Number(details.amount).toLocaleString(language, { maximumFractionDigits: 8 })}
              </Text>
              <Text emphasized secondary subHeadline>
                &nbsp;{details.symbol}&nbsp;
              </Text>
              <AssetLogo height={16} symbol={details.symbol} width={16} />
            </XStack>
          </YStack>
        </YStack>
        {(success || sendError) && <TransactionDetails hash={hash} />}
        {routed && success && (
          <Text caption mono color="$uiNeutralPlaceholder" padding="$s3">
            {
              `destination ${destinationChain} · ${routeStatus?.status ?? "pending"} ${routeStatus?.substatus ?? ""}` /* cspell:ignore substatus */
            }
          </Text>
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
                  router.dismissTo("/activity");
                }}
              >
                {!details.external && isLatestPlugin ? t("View pending requests") : t("Close")}
              </Text>
            </View>
          )}
          {sendError && (
            <YStack alignItems="center" gap="$s4">
              <Pressable onPress={reset}>
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

function reason(error: unknown) {
  const texts = new Set<string>();
  let current = error;
  while (current && typeof current === "object") {
    const { cause, details, message, responseBody, shortMessage } = current as {
      cause?: unknown;
      details?: string;
      message?: string;
      responseBody?: {
        code?: number;
        errors?: { filteredOut?: { reason?: string; tool?: string }[] };
        message?: string;
      };
      shortMessage?: string;
    };
    if (responseBody?.message) texts.add(`${responseBody.code ?? ""} ${responseBody.message}`.trim());
    for (const { reason: filtered, tool } of responseBody?.errors?.filteredOut ?? []) {
      texts.add(`${tool ?? "?"}: ${filtered ?? "filtered out"}`);
    }
    if (shortMessage) texts.add(shortMessage);
    if (details) texts.add(details);
    if (message) texts.add(message.split("\n")[0] ?? message);
    current = cause;
  }
  return [...texts].join(" · ").slice(0, 300) || "unknown error";
}
