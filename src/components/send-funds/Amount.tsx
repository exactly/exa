import ProposalType from "@exactly/common/ProposalType";
import { exaPluginAddress } from "@exactly/common/generated/chain";
import {
  exaPluginAbi,
  upgradeableModularAccountAbi,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import { ArrowLeft, Coins, User, FilePen, Check, X } from "@tamagui/lucide-icons";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable } from "react-native";
import { Avatar, ScrollView, Square, XStack, YStack } from "tamagui";
import { bigint, check, parse, pipe } from "valibot";
import { encodeAbiParameters, erc20Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { useBytecode, useSimulateContract, useWriteContract } from "wagmi";

import ReviewSheet from "./ReviewSheet";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import assetLogos from "../../utils/assetLogos";
import queryClient from "../../utils/queryClient";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import AmountSelector from "../shared/AmountSelector";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import GradientScrollView from "../shared/GradientScrollView";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

export default function Amount() {
  const navigation = useNavigation<AppNavigationProperties>();
  const { address } = useAccount();
  const [reviewOpen, setReviewOpen] = useState(false);

  const { asset: assetAddress, receiver: receiverAddress, amount } = useLocalSearchParams();
  const withdrawAsset = parse(Address, assetAddress);
  const withdrawReceiver = parse(Address, receiverAddress);

  const { market, externalAsset: external, available, isFetching } = useAsset(withdrawAsset);

  const form = useForm({ defaultValues: { amount: typeof amount === "string" ? BigInt(amount) : 0n } });
  const formAmount = useStore(form.store, (state) => state.values.amount);

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
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
            encodeAbiParameters([{ type: "address" }], [withdrawReceiver]),
          ],
          query: { enabled: !!market && !!address && !!bytecode && formAmount > 0n },
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
          args: [withdrawAsset, formAmount, withdrawReceiver],
          query: { enabled: !!market && !!address && !!bytecode && formAmount > 0n },
        },
  );

  const { data: transferSimulation } = useSimulateContract({
    address: parse(Address, external?.address ?? zeroAddress),
    abi: erc20Abi,
    functionName: "transfer",
    args: [withdrawReceiver, formAmount],
    query: { enabled: !!external && !!address && !!bytecode && formAmount > 0n },
  });

  const { writeContract, data: hash, isPending: pending, isSuccess: success, isError: error } = useWriteContract();

  const handleSubmit = useCallback(() => {
    if (market) {
      if (!proposeSimulation) throw new Error("no propose simulation");
      writeContract(proposeSimulation.request);
    } else {
      if (!external) throw new Error("no external asset");
      if (!transferSimulation) throw new Error("no transfer simulation");
      writeContract(transferSimulation.request);
    }
  }, [market, proposeSimulation, writeContract, external, transferSimulation]);

  const details: {
    external: boolean;
    symbol?: string;
    amount: string;
    usdValue: string;
  } = useMemo(
    () =>
      market
        ? {
            external: false,
            symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            amount: formatUnits(formAmount, market.decimals),
            usdValue: formatUnits((formAmount * market.usdPrice) / WAD, market.decimals),
          }
        : {
            external: true,
            symbol: external?.symbol,
            amount: formatUnits(formAmount, external?.decimals ?? 0),
            usdValue: formatUnits(
              (formAmount * parseUnits(external?.priceUSD ?? "0", 18)) / WAD,
              external?.decimals ?? 0,
            ),
          },
    [external, market, formAmount],
  );

  const { data: recentContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });

  const canSend =
    withdrawReceiver !== parse(Address, zeroAddress) && market ? !!proposeSimulation : !!transferSimulation;
  const isFirstSend = !recentContacts?.some((contact) => contact.address === withdrawReceiver);

  useEffect(() => {
    if (success && !recentContacts?.some((contact) => contact.address === withdrawReceiver)) {
      queryClient.setQueryData<{ address: Address; ens: string }[] | undefined>(["contacts", "recent"], (old) =>
        [{ address: withdrawReceiver, ens: "" }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [success, withdrawReceiver, recentContacts]);

  if (!pending && !error && !success) {
    return (
      <SafeView fullScreen>
        <View gap={20} fullScreen padded>
          <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (navigation.canGoBack()) {
                    navigation.goBack();
                  } else {
                    navigation.replace("send-funds", { screen: "asset" });
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <Text color="$uiNeutralPrimary" fontSize={15} fontWeight="bold">
              Enter amount
            </Text>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            // eslint-disable-next-line react-native/no-inline-styles
            contentContainerStyle={{ flexGrow: 1 }}
            gap="$s5"
          >
            <View flex={1} gap="$s5" paddingBottom="$s5">
              <View gap="$s3">
                <XStack
                  alignItems="center"
                  backgroundColor="$backgroundBrandSoft"
                  borderRadius="$r2"
                  justifyContent="space-between"
                >
                  <XStack alignItems="center" gap="$s3" padding="$s3">
                    <Avatar size={32} backgroundColor="$interactiveBaseBrandDefault" borderRadius="$r_0">
                      <User size={20} color="$interactiveOnBaseBrandDefault" />
                    </Avatar>
                    <Text emphasized callout color="$uiNeutralSecondary">
                      To:
                    </Text>
                    <Text callout color="$uiNeutralPrimary" fontFamily="$mono">
                      {shortenHex(withdrawReceiver)}
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
                        Available:
                      </Text>
                      <Text callout color="$uiNeutralPrimary" numberOfLines={1}>
                        {market ? (
                          <>
                            {`${(Number(available) / 10 ** market.decimals).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: market.decimals,
                            })} ${market.symbol.slice(3)}`}
                          </>
                        ) : external ? (
                          <>
                            {`${(Number(available) / 10 ** external.decimals).toLocaleString(undefined, {
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
                    }, "amount cannot be 0"),
                    check((value) => {
                      return value <= available;
                    }, "amount cannot be greater than available"),
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
                    contained
                    main
                    spaced
                    disabled={!isValid || !isTouched}
                    iconAfter={
                      <FilePen
                        color={isValid && isTouched ? "$interactiveOnBaseBrandDefault" : "$interactiveOnDisabled"}
                      />
                    }
                    onPress={() => {
                      setReviewOpen(true);
                    }}
                  >
                    Review
                  </Button>
                );
              }}
            </form.Subscribe>
          </ScrollView>
        </View>
        <ReviewSheet
          open={reviewOpen}
          onClose={() => {
            setReviewOpen(false);
          }}
          onSend={() => {
            setReviewOpen(false);
            handleSubmit();
          }}
          canSend={canSend}
          details={details}
          isFirstSend={isFirstSend}
        />
      </SafeView>
    );
  }

  return (
    <GradientScrollView variant={error ? "error" : success ? (isLatestPlugin ? "info" : "success") : "neutral"}>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <Pressable
            aria-label="Close"
            onPress={() => {
              navigation.replace("send-funds", { screen: "index" });
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
                  Sending to&nbsp;
                  <Text emphasized primary body color="$uiNeutralPrimary">
                    {shortenHex(withdrawReceiver, 5, 7)}
                  </Text>
                </>
              )}
              {success && (
                <>
                  {isLatestPlugin ? "Processing" : "Paid"}&nbsp;
                  <Text emphasized primary body color="$uiNeutralPrimary">
                    Withdrawal
                  </Text>
                </>
              )}
              {error && (
                <>
                  Failed&nbsp;
                  <Text emphasized primary body color="$uiNeutralPrimary">
                    {shortenHex(withdrawReceiver, 3, 5)}
                  </Text>
                </>
              )}
            </Text>
            <Text title primary color="$uiNeutralPrimary">
              {Number(details.usdValue).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
              })}
            </Text>
            <XStack gap="$s2" alignItems="center">
              <Text emphasized secondary subHeadline>
                {Number(details.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
              </Text>
              <Text emphasized secondary subHeadline>
                &nbsp;{details.symbol}&nbsp;
              </Text>
              <AssetLogo
                {...(details.external
                  ? {
                      external: true,
                      source: { uri: external?.logoURI },
                      width: 16,
                      height: 16,
                      borderRadius: 20,
                    }
                  : { uri: assetLogos[details.symbol as keyof typeof assetLogos], width: 16, height: 16 })}
              />
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
                  if (!details.external && isLatestPlugin) {
                    navigation.replace("pending-proposals/index");
                  } else {
                    navigation.replace("send-funds", { screen: "index" });
                  }
                }}
              >
                {!details.external && isLatestPlugin ? "View pending requests" : "Close"}
              </Text>
            </View>
          )}
          {error && (
            <YStack alignItems="center" gap="$s4">
              <Pressable
                onPress={() => {
                  navigation.replace("send-funds", { screen: "index" });
                }}
              >
                <Text emphasized footnote color="$uiBrandSecondary">
                  Close
                </Text>
              </Pressable>
            </YStack>
          )}
        </YStack>
      )}
    </GradientScrollView>
  );
}
