import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, WAD, withdrawLimit } from "@exactly/lib";
import { CircleHelp, Check } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { XStack, YStack } from "tamagui";
import { formatUnits, parseUnits, zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadPreviewerExactly, useReadPreviewerPreviewBorrowAtMaturity } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getCard, setCardMode } from "../../utils/server";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import useIntercom from "../../utils/useIntercom";
import Skeleton from "../shared/Skeleton";
import TamaguiInput from "../shared/TamaguiInput";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaySelector() {
  const toast = useToastController();
  const { presentArticle } = useIntercom();
  const [input, setInput] = useState("100");
  const assets = useMemo(() => {
    return parseUnits(input.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 6);
  }, [input]);
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const { firstMaturity } = useInstallments({
    totalAmount: assets,
    installments: 1,
  });

  const { data: card } = useQuery({
    queryKey: ["card", "details"],
    queryFn: getCard,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });
  const { mutateAsync: mutateMode } = useMutation({
    mutationKey: ["card", "mode"],
    mutationFn: setCardMode,
    onMutate: async (newMode) => {
      await queryClient.cancelQueries({ queryKey: ["card", "details"] });
      const previous = queryClient.getQueryData(["card", "details"]);
      queryClient.setQueryData(["card", "details"], (old: Awaited<ReturnType<typeof getCard>>) => ({
        ...old,
        mode: newMode,
      }));
      return { previous };
    },
    onError: (error, _, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["card", "details"], context.previous);
      }
      reportError(error);
    },
    onSettled: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ["card", "details"] });
      if (data && "mode" in data && data.mode > 0) {
        queryClient.setQueryData(["settings", "installments"], data.mode);
      }
    },
  });

  function setInstallments(installments: number) {
    if (!card || card.mode === installments) return;
    mutateMode(installments).catch(reportError);
    const message =
      installments === 0 ? "Pay Now selected" : `${installments} installment${installments > 1 ? "s" : ""} selected`;
    toast.show(message, {
      native: true,
      duration: 1000,
      burntOptions: { haptic: "success" },
    });
  }
  return (
    <>
      <View backgroundColor="$backgroundSoft" padded>
        <YStack paddingBottom="$s3" gap="$s4_5">
          <XStack gap={10} justifyContent="space-between" alignItems="center">
            <Text fontSize={20} fontWeight="bold">
              Pay Mode
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("9465994").catch(reportError);
              }}
            >
              <CircleHelp color="$uiNeutralSecondary" />
            </Pressable>
          </XStack>
          <Text subHeadline secondary>
            Choose <Text emphasized>Pay Now</Text> to instantly pay your purchases, or select a plan to split them into
            up to {MAX_INSTALLMENTS} fixed-rate installments in USDC, powered by Exactly Protocol.*
          </Text>

          <XStack alignItems="center" gap="$s4">
            <Text primary emphasized subHeadline>
              Simulate purchase
            </Text>
            <TamaguiInput borderRadius="$r3" backgroundColor="$backgroundMild" flex={1}>
              <TamaguiInput.Icon>
                <Text subHeadline color="$uiNeutralPlaceholder">
                  {(0)
                    .toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                    .replaceAll(/\d/g, "")
                    .trim()}
                </Text>
              </TamaguiInput.Icon>
              <TamaguiInput.Input
                maxLength={10}
                numberOfLines={1}
                inputMode="decimal"
                textAlign="right"
                fontSize={20}
                lineHeight={25}
                letterSpacing={-0.2}
                value={input}
                onChangeText={(text) => {
                  setInput(text);
                }}
              />
            </TamaguiInput>
          </XStack>
        </YStack>
      </View>
      <View padded>
        <XStack justifyContent="space-between" paddingHorizontal="$s3" paddingBottom="$s4">
          <Text caption color="$uiNeutralPlaceholder">
            INSTANT PAY
          </Text>
          <XStack gap="$s1">
            <Text caption color="$uiNeutralPlaceholder">
              Available limit:
            </Text>
            <Text sensitive caption color="$uiNeutralPlaceholder">
              {(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
              })}
            </Text>
          </XStack>
        </XStack>
        <YStack gap="$s1_5">
          <InstallmentButton key={0} installment={0} cardDetails={card} onSelect={setInstallments} assets={assets} />
        </YStack>
        <XStack justifyContent="space-between" paddingHorizontal="$s3" paddingVertical="$s4">
          <Text caption color="$uiNeutralPlaceholder" numberOfLines={1}>
            INSTALLMENT PLANS
          </Text>
          <XStack gap="$s1" flex={1} justifyContent="flex-end">
            <Text caption color="$uiNeutralPlaceholder" numberOfLines={1}>
              Credit limit:
            </Text>
            <Text sensitive caption color="$uiNeutralPlaceholder" numberOfLines={1}>
              {(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
              })}
            </Text>
          </XStack>
        </XStack>
        <YStack gap="$s1_5">
          {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((installment) => (
            <InstallmentButton
              key={installment}
              installment={installment}
              cardDetails={card}
              onSelect={setInstallments}
              assets={assets}
            />
          ))}
          <YStack paddingTop="$s4" paddingLeft="$s4">
            <Text caption color="$uiNeutralSecondary" numberOfLines={1} adjustsFontSizeToFit>
              First due date: {format(new Date(Number(firstMaturity) * 1000), "MMM dd, yyyy")} - then every 28 days.
            </Text>
          </YStack>
        </YStack>
      </View>
    </>
  );
}

function InstallmentButton({
  installment,
  cardDetails,
  onSelect,
  assets,
}: {
  installment: number;
  cardDetails?: { mode: number };
  onSelect: (installment: number) => void;
  assets: bigint;
}) {
  const { market, account } = useAsset(marketUSDCAddress);
  const calculationAssets = assets === 0n ? 100_000_000n : assets;
  const {
    data: installments,
    firstMaturity,
    timestamp,
    isFetching: isInstallmentsFetching,
  } = useInstallments({
    totalAmount: calculationAssets,
    installments: installment,
  });
  const { data: borrowPreview, isLoading: isBorrowPreviewLoading } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [market?.market ?? zeroAddress, BigInt(firstMaturity), calculationAssets],
    query: { enabled: !!market && !!account && !!firstMaturity && calculationAssets > 0n },
  });
  const selected = cardDetails?.mode === installment;

  return (
    <Pressable
      style={styles.button}
      onPress={() => {
        onSelect(installment);
      }}
    >
      <XStack
        key={installment}
        height={72}
        maxHeight={72}
        backgroundColor={selected ? "$interactiveBaseBrandSoftDefault" : "$backgroundSoft"}
        borderRadius="$r4"
        alignItems="center"
        padding="$s4"
        flex={1}
        gap="$s4"
      >
        <XStack
          backgroundColor={selected ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
          width={20}
          height={20}
          borderRadius={12}
          alignItems="center"
          justifyContent="center"
        >
          {selected && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
        </XStack>
        <YStack gap="$s1" flex={1}>
          <XStack gap="$s1">
            <Text headline color={installment > 0 ? "$uiNeutralSecondary" : "$uiNeutralPrimary"}>
              {installment > 0 ? `${installment}x` : "Pay Now"}
            </Text>
            {installment > 0 &&
              (isInstallmentsFetching || (installment === 1 && isBorrowPreviewLoading) ? (
                <Skeleton height={20} width="100%" />
              ) : (
                <Text headline numberOfLines={1} adjustsFontSizeToFit flex={1}>
                  {Number(
                    formatUnits(
                      assets
                        ? installments && installment > 1
                          ? (installments.installments[0] ?? 0n)
                          : (borrowPreview?.assets ?? 0n)
                        : 0n,
                      6,
                    ),
                  ).toLocaleString(undefined, { style: "currency", currency: "USD" })}
                </Text>
              ))}
          </XStack>
          {installment > 0 &&
            (isInstallmentsFetching || isBorrowPreviewLoading ? (
              <Skeleton height={20} />
            ) : (
              <Text footnote color="$uiNeutralSecondary">
                {`${
                  (installment > 1 && installments
                    ? Number(installments.effectiveRate) / 1e18
                    : borrowPreview
                      ? Number(
                          ((borrowPreview.assets - calculationAssets) * WAD * 31_536_000n) /
                            (calculationAssets * (borrowPreview.maturity - BigInt(timestamp))),
                        ) / 1e18
                      : null
                  )?.toLocaleString(undefined, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }) ?? "N/A"
                } APR`}
              </Text>
            ))}
        </YStack>
        <XStack>
          <Text
            color={assets === 0n ? "$uiNeutralSecondary" : "$uiNeutralPrimary"}
            title3
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {isInstallmentsFetching || (installment === 1 && isBorrowPreviewLoading) ? (
              <Skeleton height={20} width="100%" />
            ) : (
              (assets === 0n
                ? Number(assets)
                : Number(
                    formatUnits(
                      installment === 0
                        ? assets
                        : installments && installment > 1
                          ? installments.installments.reduce((accumulator, current) => accumulator + current, 0n)
                          : installment === 1 && borrowPreview
                            ? borrowPreview.assets
                            : 0n,
                      6,
                    ),
                  )
              ).toLocaleString(undefined, { style: "currency", currency: "USD" })
            )}
          </Text>
        </XStack>
      </XStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { flexGrow: 1 } });
