import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";
import { ArrowLeft, Check, Info } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";
import { formatUnits, parseUnits, zeroAddress } from "viem";

import { useReadPreviewerPreviewBorrowAtMaturity } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import type { getCard } from "../../utils/server";
import { setCardMode } from "../../utils/server";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import TamaguiInput from "../shared/TamaguiInput";
import Text from "../shared/Text";
import View from "../shared/View";

function setInstallments(installments: number) {
  queryClient.setQueryData(["simulate-purchase", "installments"], installments);
}
function back() {
  router.back();
}

export default function SimulatePurchase() {
  const { canGoBack } = router;
  const insets = useSafeAreaInsets();
  const { presentArticle } = useIntercom();
  const [input, setInput] = useState("100");
  const [assets, setAssets] = useState(100n);
  const { data: installments } = useQuery<number>({ queryKey: ["simulate-purchase", "installments"] });
  const {
    data: installmentsResult,
    firstMaturity,
    isFetching: isInstallmentsFetching,
  } = useInstallments({ totalAmount: assets, installments: installments ?? 1 });
  const { market, account } = useAsset(marketUSDCAddress);
  const {
    data: borrowPreview,
    isFetching: isFetchingBorrowPreview,
    isRefetching: isRefetchingBorrowPreview,
    refetch: refetchBorrowPreview,
  } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [market?.market ?? zeroAddress, BigInt(firstMaturity), assets],
    query: { enabled: !!market && !!account && !!firstMaturity && assets > 0n },
  });
  const isLoading = isInstallmentsFetching || isFetchingBorrowPreview || isRefetchingBorrowPreview;
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
      back();
      await queryClient.invalidateQueries({ queryKey: ["card", "details"] });
      if (data && "mode" in data && data.mode > 0) {
        queryClient.setQueryData(["settings", "installments"], data.mode);
      }
    },
  });
  useEffect(() => {
    const value = parseUnits(input.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 6);
    setAssets(value);
  }, [input]);
  useEffect(() => {
    if (!isInstallmentsFetching) return;
    refetchBorrowPreview().catch(reportError);
  }, [isInstallmentsFetching, refetchBorrowPreview]);
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild" paddingBottom={0}>
      <View fullScreen>
        <View padded>
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            {canGoBack() && (
              <Pressable onPress={back}>
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            )}
            <Text emphasized subHeadline>
              Estimate your payments
            </Text>
            <Pressable
              onPress={() => {
                presentArticle("8971590").catch(reportError);
              }}
            >
              <Info color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          <View padded>
            <YStack gap="$s4_5" width="100%">
              <YStack gap="$s3_5">
                <Text primary emphasized headline>
                  Choose number of installments
                </Text>
                <Text caption textTransform="uppercase" color="$uiBrandSecondary">
                  First due date → {format(new Date(Number(firstMaturity) * 1000), "MMM dd, yyyy")}
                </Text>
              </YStack>
              <XStack gap="$s3_5" flexWrap="wrap">
                {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((installment) => (
                  <InstallmentButton
                    key={installment}
                    installment={installment}
                    cardDetails={{ mode: installments ?? 1 }}
                    onSelect={setInstallments}
                    assets={assets}
                  />
                ))}
              </XStack>
              <YStack justifyContent="space-between" gap="$s4">
                <Text primary emphasized headline>
                  Enter purchase amount
                </Text>
                <XStack alignItems="center" gap="$s2">
                  <TamaguiInput borderRadius="$r3" backgroundColor="$backgroundMild">
                    <TamaguiInput.Icon>
                      <Text primary title3>
                        {(0)
                          .toLocaleString(undefined, {
                            style: "currency",
                            currency: "USD",
                            maximumFractionDigits: 0,
                          })
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
            </YStack>
          </View>
        </ScrollView>
        <View
          padded
          backgroundColor="$backgroundSoft"
          borderRadius="$r4"
          borderBottomLeftRadius={0}
          borderBottomRightRadius={0}
        >
          <YStack gap="$s4" paddingBottom={insets.bottom}>
            <XStack justifyContent="space-between" gap="$s3" alignItems="center">
              <Text secondary footnote textAlign="left">
                Interest amount
              </Text>
              <Text primary title3 textAlign="right">
                {installments && installments > 1 && installmentsResult
                  ? Number(
                      formatUnits(
                        installmentsResult.installments.reduce((accumulator, current) => accumulator + current, 0n) -
                          assets,
                        6,
                      ),
                    ).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                    })
                  : installments === 1 && borrowPreview
                    ? Number(formatUnits(borrowPreview.assets - assets, 6)).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                      })
                    : "N/A"}
              </Text>
            </XStack>
            <XStack justifyContent="space-between" gap="$s3" alignItems="center">
              <Text secondary footnote textAlign="left">
                Total cost
              </Text>
              <Text primary title3 textAlign="right">
                {installments && installments > 1 && installmentsResult
                  ? installmentsResult.installments
                      .reduce((accumulator, current) => accumulator + Number(formatUnits(current, 6)), 0)
                      .toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                      })
                  : installments === 1 && borrowPreview
                    ? Number(formatUnits(borrowPreview.assets, 6)).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                      })
                    : "N/A"}
              </Text>
            </XStack>
            <Separator height={1} borderColor="$borderNeutralSoft" />
            <XStack justifyContent="space-between" gap="$s3" alignItems="center">
              <Text secondary footnote textAlign="left">
                You&apos;ll pay{" "}
                <Text secondary footnote>
                  {installments} {installments === 1 ? "installment" : "installments"} of{" "}
                </Text>
              </Text>
              <YStack>
                <Text title color="$uiBrandSecondary" textAlign="right">
                  {installments && installments > 1 && installmentsResult
                    ? Number(formatUnits(installmentsResult.installments[0] ?? 0n, 6)).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                      })
                    : installments === 1 && borrowPreview
                      ? Number(formatUnits(borrowPreview.assets, 6)).toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                        })
                      : "N/A"}
                </Text>
                {installments && installments > 1 && (
                  <Text subHeadline primary textAlign="right">
                    each
                  </Text>
                )}
              </YStack>
            </XStack>
            <Button
              onPress={() => {
                mutateMode(installments ?? 1).catch(reportError);
              }}
              contained
              disabled={isLoading}
              main
              spaced
              fullwidth
              noFlex
              iconAfter={
                isLoading ? (
                  <Spinner color="$interactiveOnDisabled" />
                ) : (
                  <Check strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />
                )
              }
            >
              {isLoading
                ? "Please wait..."
                : `Set ${installments} ${installments === 1 ? "installment" : "installments"}`}
            </Button>
          </YStack>
        </View>
      </View>
    </SafeView>
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
  const {
    data: installments,
    firstMaturity,
    timestamp,
  } = useInstallments({
    totalAmount: assets,
    installments: installment,
  });
  const { data: borrowPreview } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [market?.market ?? zeroAddress, BigInt(firstMaturity), assets],
    query: { enabled: !!market && !!account && !!firstMaturity && assets > 0n },
  });
  const enabled = cardDetails?.mode && cardDetails.mode > 0;
  const selected = cardDetails?.mode === installment;
  return (
    <Pressable
      style={styles.button}
      onPress={() => {
        if (!enabled) return;
        onSelect(installment);
      }}
    >
      <View
        key={installment}
        height={93}
        maxHeight={93}
        borderWidth={1}
        backgroundColor={selected ? "$interactiveBaseBrandDefault" : "transparent"}
        borderColor={enabled ? "$borderBrandSoft" : "$interactiveDisabled"}
        borderRadius="$r4"
        alignItems="center"
        justifyContent="center"
        padding="$s4"
        width="auto"
        flexGrow={1}
      >
        <Text
          title
          color={
            selected
              ? "$interactiveOnBaseBrandDefault"
              : enabled
                ? "$interactiveOnBaseBrandSoft"
                : "$uiNeutralSecondary"
          }
        >
          {installment}
        </Text>
        <Text
          footnote
          color={
            selected
              ? "$interactiveOnBaseBrandDefault"
              : enabled
                ? "$interactiveOnBaseBrandSoft"
                : "$uiNeutralSecondary"
          }
        >
          {`${
            installment > 1
              ? installments
                ? (Number(installments.effectiveRate) / 1e18).toLocaleString(undefined, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "N/A"
              : borrowPreview
                ? (
                    Number(
                      ((borrowPreview.assets - assets) * WAD * 31_536_000n) /
                        (assets * (borrowPreview.maturity - BigInt(timestamp))),
                    ) / 1e18
                  ).toLocaleString(undefined, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : "N/A"
          } APR`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { flexGrow: 1 } });
