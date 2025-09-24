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

import ManualRepaymentSheet from "./ManualRepaymentSheet";
import { useReadPreviewerExactly, useReadPreviewerPreviewBorrowAtMaturity } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { getCard, setCardMode } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import useIntercom from "../../utils/useIntercom";
import AssetLogo from "../shared/AssetLogo";
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

  const { data: manualRepaymentAcknowledged } = useQuery<boolean>({ queryKey: ["manual-repayment-acknowledged"] });
  const [manualRepaymentSheetOpen, setManualRepaymentSheetOpen] = useState(false);
  const [pendingInstallment, setPendingInstallment] = useState<number | null>(null);

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

  function setInstallments(value: number) {
    if (!card || card.mode === value) return;
    mutateMode(value).catch(reportError);
    const message = value === 0 ? "Pay Now selected" : `${value} installment${value > 1 ? "s" : ""} selected`;
    toast.show(message, {
      native: true,
      duration: 1000,
      burntOptions: { haptic: "success" },
    });
  }

  function handleInstallmentSelection(value: number) {
    if (value === 0) {
      setInstallments(value);
      return;
    }
    if (!manualRepaymentAcknowledged) {
      setPendingInstallment(value);
      setManualRepaymentSheetOpen(true);
      return;
    }
    setInstallments(value);
  }

  function handleConfirm() {
    queryClient.setQueryData(["manual-repayment-acknowledged"], true);
    if (pendingInstallment !== null) {
      setInstallments(pendingInstallment);
    }
    setPendingInstallment(null);
    setManualRepaymentSheetOpen(false);
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
            Choose <Text emphasized>Pay Now</Text> to pay from your USDC balance, or Pay Later to split your purchase
            into up to {MAX_INSTALLMENTS} fixed-rate USDC installments, powered by Exactly Protocol.*
          </Text>
          <XStack alignItems="center" gap="$s4" flex={1} width="100%">
            <Text primary emphasized subHeadline>
              Simulate a purchase of
            </Text>
            <TamaguiInput borderRadius="$r3" flex={1}>
              <TamaguiInput.Icon>
                <Text subHeadline color="$uiNeutralPlaceholder">
                  USDC
                </Text>
              </TamaguiInput.Icon>
              <TamaguiInput.Input
                maxLength={6}
                numberOfLines={1}
                inputMode="decimal"
                textAlign="right"
                fontSize={20}
                lineHeight={25}
                value={input}
                width="100%"
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
            INSTANT PAY (USDC)
          </Text>
          <XStack gap="$s1">
            <Text caption color="$uiNeutralPlaceholder">
              Available limit: USDC
            </Text>
            <Text sensitive caption color="$uiNeutralPlaceholder">
              {(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </XStack>
        </XStack>
        <YStack gap="$s1_5">
          <InstallmentButton
            key={0}
            installment={0}
            cardDetails={card}
            onSelect={handleInstallmentSelection}
            assets={assets}
          />
        </YStack>
        <XStack justifyContent="space-between" paddingHorizontal="$s3" paddingVertical="$s4">
          <Text caption color="$uiNeutralPlaceholder" numberOfLines={1}>
            INSTALLMENT PLANS
          </Text>
          <XStack gap="$s1" flex={1} justifyContent="flex-end">
            <Text caption color="$uiNeutralPlaceholder" numberOfLines={1}>
              Credit limit: USDC
            </Text>
            <Text sensitive caption color="$uiNeutralPlaceholder" numberOfLines={1}>
              {(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
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
              onSelect={handleInstallmentSelection}
              assets={assets}
            />
          ))}
          <YStack paddingTop="$s4" paddingLeft="$s4">
            <Text caption color="$uiNeutralSecondary" numberOfLines={1} adjustsFontSizeToFit>
              First due date: {format(new Date(firstMaturity * 1000), "MMM dd, yyyy")} - then every 28 days.
            </Text>
          </YStack>
        </YStack>
        <ManualRepaymentSheet
          open={manualRepaymentSheetOpen}
          onClose={() => {
            setManualRepaymentSheetOpen(false);
          }}
          onActionPress={handleConfirm}
        />
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
          <XStack gap="$s2" alignItems="center">
            <Text headline color={installment > 0 ? "$uiNeutralSecondary" : "$uiNeutralPrimary"}>
              {installment > 0 ? `${installment}x` : "Pay Now"}
            </Text>
            {installment > 0 && <AssetLogo uri={assetLogos.USDC} width={17} height={17} />}

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
                  ).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
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
        <XStack alignItems="center" gap="$s2">
          <Text caption color="$uiNeutralPlaceholder">
            USDC
          </Text>
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
              ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            )}
          </Text>
        </XStack>
      </XStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { flexGrow: 1 } });
