import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, Check, Coins, FilePen, X } from "@tamagui/lucide-icons";
import { Avatar, ScrollView, Square, XStack, YStack } from "tamagui";

import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { bigint, check, parse, pipe, safeParse } from "valibot";
import { encodeAbiParameters, erc20Abi, formatUnits, parseUnits, zeroAddress as viemZeroAddress } from "viem";
import { useBytecode, useEstimateGas, useSendTransaction, useSimulateContract, useWriteContract } from "wagmi";

import accountInit from "@exactly/common/accountInit";
import { exaPluginAddress } from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import shortenHex from "@exactly/common/shortenHex";
import { Address, type Credential } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import ReviewSheet from "./ReviewSheet";
import queryClient from "../../utils/queryClient";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import AmountSelector from "../shared/AmountSelector";
import AssetLogo from "../shared/AssetLogo";
import Blocky from "../shared/Blocky";
import GradientScrollView from "../shared/GradientScrollView";
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

  const { asset: assetAddress, receiver: receiverAddress, amount } = useLocalSearchParams();
  const withdrawAssetParse = safeParse(Address, assetAddress);
  const withdrawReceiverParse = safeParse(Address, receiverAddress);
  const zeroAddress = parse(Address, viemZeroAddress);
  const withdrawAsset = withdrawAssetParse.success ? withdrawAssetParse.output : undefined;
  const receiver = withdrawReceiverParse.success ? withdrawReceiverParse.output : undefined;

  const { market, externalAsset: external, available, isFetching } = useAsset(withdrawAsset ?? zeroAddress);

  const form = useForm({ defaultValues: { amount: typeof amount === "string" ? BigInt(amount) : 0n } });
  const formAmount = useStore(form.store, (state) => state.values.amount);

  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: bytecode } = useBytecode({ address, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!address && !!credential },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  const { data: proposeSimulation } = useSimulateContract(
    isLatestPlugin
      ? {
          address,
          functionName: "propose",
          abi: [...upgradeableModularAccountAbi, ...exaPluginAbi],
          args: [
            market?.market ?? zeroAddress,
            formAmount,
            ProposalType.Withdraw,
            encodeAbiParameters([{ type: "address" }], [receiver ?? zeroAddress]),
          ],
          query: {
            enabled: !!market && !!address && !!bytecode && formAmount > 0n && !!receiver && receiver !== zeroAddress,
          },
        }
      : {
          address,
          functionName: "propose",
          abi: [
            ...upgradeableModularAccountAbi,
            {
              type: "function",
              name: "propose",
              inputs: [
                { internalType: "contract IMarket", name: "market", type: "address" },
                { internalType: "uint256", name: "amount", type: "uint256" },
                { internalType: "address", name: "receiver", type: "address" },
              ],
              outputs: [],
              stateMutability: "nonpayable",
            },
          ],
          args: [withdrawAsset ?? zeroAddress, formAmount, receiver ?? zeroAddress],
          query: {
            enabled: !!market && !!address && !!bytecode && formAmount > 0n && !!receiver && receiver !== zeroAddress,
          },
        },
  );

  const externalAddress = useMemo(() => {
    const { success, output } = safeParse(Address, external?.address);
    return success ? output : zeroAddress;
  }, [external?.address, zeroAddress]);

  const isNativeTransfer = !!external && externalAddress === zeroAddress;

  const { data: erc20TransferSimulation } = useSimulateContract({
    address: externalAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: receiver ? [receiver, formAmount] : undefined,
    query: {
      enabled:
        !!external &&
        !isNativeTransfer &&
        !!address &&
        !!bytecode &&
        formAmount > 0n &&
        !!receiver &&
        receiver !== zeroAddress,
    },
  });

  const { data: nativeTransferEstimate } = useEstimateGas({
    to: receiver,
    value: formAmount,
    query: {
      enabled: !!external && isNativeTransfer && !!address && formAmount > 0n && !!receiver && receiver !== zeroAddress,
    },
  });

  const {
    mutate: sendNative,
    data: nativeHash,
    isPending: nativePending,
    isSuccess: nativeSuccess,
    isError: nativeError,
    reset: nativeReset,
  } = useSendTransaction();

  const {
    mutate: sendContract,
    data: contractHash,
    isPending: contractPending,
    isSuccess: contractSuccess,
    isError: contractError,
    reset: contractReset,
  } = useWriteContract();

  const hash = isNativeTransfer ? nativeHash : contractHash;
  const pending = isNativeTransfer ? nativePending : contractPending;
  const success = isNativeTransfer ? nativeSuccess : contractSuccess;
  const error = isNativeTransfer ? nativeError : contractError;
  const reset = isNativeTransfer ? nativeReset : contractReset;

  const sendReady = useMemo(
    () =>
      formAmount > 0n &&
      (market
        ? !!proposeSimulation
        : !!external && (isNativeTransfer ? !!nativeTransferEstimate : !!erc20TransferSimulation)),
    [
      external,
      formAmount,
      isNativeTransfer,
      market,
      nativeTransferEstimate,
      proposeSimulation,
      erc20TransferSimulation,
    ],
  );

  const handleSubmit = useCallback(() => {
    if (!sendReady || !receiver) return;
    if (proposeSimulation) {
      sendContract(proposeSimulation.request);
    } else if (isNativeTransfer) {
      sendNative({ to: receiver, value: formAmount });
    } else if (erc20TransferSimulation) {
      sendContract(erc20TransferSimulation.request);
    }
  }, [
    erc20TransferSimulation,
    formAmount,
    isNativeTransfer,
    proposeSimulation,
    receiver,
    sendContract,
    sendNative,
    sendReady,
  ]);

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
    if (success && receiver && !recentContacts?.some((contact) => contact.address === receiver)) {
      queryClient.setQueryData<undefined | { address: Address; ens: string }[]>(["contacts", "recent"], (old) =>
        [{ address: receiver, ens: "" }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [success, receiver, recentContacts]);

  const invalidReceiver = !receiver || receiver === zeroAddress;
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

  if (!pending && !error && !success) {
    return (
      <SafeView fullScreen>
        <View gap="$s4_5" fullScreen padded>
          <View flexDirection="row" gap="$s3_5" justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/send-funds/asset");
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
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
                    <Text callout color="$uiNeutralPrimary">
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
            handleSubmit();
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
    <GradientScrollView variant={error ? "error" : success ? (isLatestPlugin ? "info" : "success") : "neutral"}>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <Pressable
            aria-label={t("Close")}
            onPress={() => {
              router.dismissTo("/activity");
            }}
          >
            <X size={24} color="$uiNeutralPrimary" />
          </Pressable>
          <XStack justifyContent="center" alignItems="center">
            <Square
              size={80}
              borderRadius="$r4"
              backgroundColor={
                error
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
              {error && <X size={48} color="$uiErrorSecondary" strokeWidth={2} />}
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
              {error && (
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
        {(success || error) && <TransactionDetails hash={hash} />}
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
          {error && (
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
