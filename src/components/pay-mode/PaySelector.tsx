import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly, useReadPreviewerPreviewBorrowAtMaturity } from "@exactly/common/generated/hooks";
import { borrowLimit, WAD, withdrawLimit } from "@exactly/lib";
import { Check, CircleHelp } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable, StyleSheet } from "react-native";
import { XStack, YStack } from "tamagui";
import { formatUnits, parseUnits, zeroAddress } from "viem";

import assetLogos from "../../utils/assetLogos";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { setCardMode, type CardDetails } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import Input from "../shared/Input";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";
import ManualRepaymentSheet from "./ManualRepaymentSheet";

export default function PaySelector() {
  const toast = useToastController();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [input, setInput] = useState("100");
  const assets = useMemo(() => {
    return parseUnits(input.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 6);
  }, [input]);
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const exaUSDC = markets?.find(({ market }) => market === marketUSDCAddress);
  const { firstMaturity } = useInstallments({
    totalAmount: assets,
    installments: 1,
  });

  const { data: manualRepaymentAcknowledged } = useQuery<boolean>({ queryKey: ["manual-repayment-acknowledged"] });
  const [manualRepaymentSheetOpen, setManualRepaymentSheetOpen] = useState(false);
  const [pendingInstallment, setPendingInstallment] = useState<number | null>(null);

  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const { mutateAsync: mutateMode } = useMutation({
    mutationKey: ["card", "mode"],
    mutationFn: setCardMode,
    onMutate: async (newMode) => {
      await queryClient.cancelQueries({ queryKey: ["card", "details"] });
      const previous = queryClient.getQueryData(["card", "details"]);
      queryClient.setQueryData(["card", "details"], (old: CardDetails) => ({ ...old, mode: newMode }));
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
    const message = value === 0 ? t("Pay Now selected") : t("Installments selected", { count: value });
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
              {t("Pay Mode")}
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
            <Trans
              i18nKey="Choose <strong>Pay Now</strong> to pay from your USDC balance, or Pay Later to split your purchase into up to {{max}} fixed-rate USDC installments, powered by Exactly Protocol.*"
              values={{ max: MAX_INSTALLMENTS }}
              components={{ strong: <Text emphasized /> }}
            />
          </Text>
          <XStack alignItems="center" gap="$s4" flex={1} width="100%">
            <Text primary emphasized subHeadline>
              {t("Simulate a purchase of")}
            </Text>
            <XStack
              alignItems="center"
              backgroundColor="$backgroundSoft"
              borderColor="$borderNeutralMild"
              borderRadius="$r2"
              borderWidth={1}
              flex={1}
              focusStyle={{ borderColor: "$borderBrandStrong" }}
              focusVisibleStyle={{
                outlineWidth: 0,
                borderColor: "$borderBrandStrong",
                outlineColor: "$borderBrandStrong",
              }}
              gap="$s2"
              paddingHorizontal="$s3"
            >
              <Text subHeadline color="$uiNeutralPlaceholder" userSelect="none">
                USDC
              </Text>
              <Input
                borderWidth={0}
                inputMode="decimal"
                maxLength={6}
                numberOfLines={1}
                onChangeText={setInput}
                style={{ fontSize: 20, lineHeight: 25, padding: 0, flex: 1 }}
                textAlign="right"
                value={input}
                width="100%"
              />
            </XStack>
          </XStack>
        </YStack>
      </View>
      <View padded>
        <XStack justifyContent="space-between" paddingHorizontal="$s3" paddingBottom="$s4">
          <Text caption color="$uiNeutralPlaceholder">
            {t("INSTANT PAY ({{asset}})", { asset: "USDC" })}
          </Text>
          <XStack gap="$s1">
            <Text caption color="$uiNeutralPlaceholder">
              {t("Available limit: {{asset}}", { asset: "USDC" })}
            </Text>
            <Text sensitive caption color="$uiNeutralPlaceholder">
              {(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(language, {
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
            {t("INSTALLMENT PLANS")}
          </Text>
          <XStack gap="$s1" flex={1} justifyContent="flex-end">
            <Text caption color="$uiNeutralPlaceholder" numberOfLines={1}>
              {t("Credit limit: {{asset}}", { asset: "USDC" })}
            </Text>
            <Text sensitive caption color="$uiNeutralPlaceholder" numberOfLines={1}>
              {(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(language, {
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
              {t("First due date: {{date}} - then every 28 days.", {
                date: new Date(firstMaturity * 1000).toLocaleDateString(language, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                }),
              })}
            </Text>
          </YStack>
        </YStack>
        <ManualRepaymentSheet
          open={manualRepaymentSheetOpen}
          onClose={() => {
            setManualRepaymentSheetOpen(false);
          }}
          onActionPress={handleConfirm}
          penaltyRate={exaUSDC?.penaltyRate}
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
  cardDetails?: { mode: number } | null;
  onSelect: (installment: number) => void;
  assets: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
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

  const apr =
    installment > 0
      ? installment > 1 && installments
        ? Number(installments.effectiveRate) / 1e18
        : borrowPreview
          ? Number(
              ((borrowPreview.assets - calculationAssets) * WAD * 31_536_000n) /
                (calculationAssets * (borrowPreview.maturity - BigInt(timestamp))),
            ) / 1e18
          : 0
      : 0;

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
              {installment > 0 ? `${installment}x` : t("Pay Now")}
            </Text>
            {installment > 0 && <AssetLogo source={{ uri: assetLogos.USDC }} width={17} height={17} />}

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
                  ).toLocaleString(language, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                </Text>
              ))}
          </XStack>
          {installment > 0 &&
            (isInstallmentsFetching || isBorrowPreviewLoading ? (
              <Skeleton height={20} />
            ) : (
              <Text footnote color="$uiNeutralSecondary">
                {t("{{apr}} APR", {
                  apr: apr.toLocaleString(language, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                })}
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
              ).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            )}
          </Text>
        </XStack>
      </XStack>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { flexGrow: 1 } });
