import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";

import { nonEmpty, pipe, safeParse, string } from "valibot";
import { ContractFunctionExecutionError, encodeAbiParameters, zeroAddress } from "viem";
import { useBytecode, useWriteContract } from "wagmi";

import { exaPreviewerAddress, marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import {
  useReadExaPreviewerPendingProposals,
  useReadPreviewerPreviewBorrowAtMaturity,
  useSimulateExaPluginPropose,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";

import SafeView from "../../components/shared/SafeView";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import Button from "../shared/Button";
import Skeleton from "../shared/Skeleton";

export default function Pay() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const { success, output: repayMaturity } = safeParse(
    pipe(string(), nonEmpty("no maturity")),
    useLocalSearchParams().maturity,
  );

  const timestamp = Math.floor(Date.now() / 1000);
  const nextMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  const borrowMaturity = Number(repayMaturity) < timestamp ? nextMaturity : Number(repayMaturity) + MATURITY_INTERVAL;
  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(success ? repayMaturity : 0));
  const rolloverMaturityBorrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(borrowMaturity));

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });

  const { data: borrowPreview } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [marketUSDCAddress, BigInt(borrowMaturity), borrow?.previewValue ?? 0n],
    query: { enabled: !!bytecode && !!exaUSDC && !!borrow && !!address && !!borrowMaturity },
  });

  if (!success || !exaUSDC || !borrow) return null;

  const previewValue = (borrow.previewValue * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals);
  const existingDebtPreviewValue =
    ((rolloverMaturityBorrow?.previewValue ?? 0n) * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals);
  const rolloverPreviewValue = borrowPreview
    ? (borrowPreview.assets * exaUSDC.usdPrice) / 10n ** BigInt(exaUSDC.decimals)
    : 0n;
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild" paddingBottom={0}>
      <View fullScreen gap="$s5" paddingTop="$s4_5">
        <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
          <View padded position="absolute" left={0}>
            <Pressable
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flex: 1, justifyContent: "space-between" }}
        >
          <View padded>
            <Text emphasized title3 textAlign="left">
              {t("Review rollover")}
            </Text>
            <YStack gap="$s4" paddingTop="$s5">
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <YStack>
                  <Text headline textAlign="left">
                    {t("Debt to rollover")}
                  </Text>
                  <Text secondary footnote textAlign="left">
                    {t("due {{date}}", {
                      date: new Date(Number(repayMaturity) * 1000).toLocaleDateString(language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }),
                    })}
                  </Text>
                </YStack>
                <Text primary title3 textAlign="right">
                  {`$${(Number(previewValue) / 1e18).toLocaleString(language, {
                    style: "decimal",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </Text>
              </XStack>
              {borrowPreview ? (
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <YStack>
                    <Text headline textAlign="left">
                      {t("Rollover interest")}
                    </Text>
                    <Text secondary footnote textAlign="left">
                      {t("{{rate}} APR", {
                        rate: (
                          Number(
                            ((borrowPreview.assets - borrow.previewValue) * WAD * 31_536_000n) /
                              (borrow.previewValue * (borrowPreview.maturity - BigInt(timestamp))),
                          ) /
                          1e18 /
                          100
                        ).toLocaleString(language, {
                          style: "percent",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }),
                      })}
                    </Text>
                  </YStack>
                  <Text primary title3 textAlign="right">
                    {`$${(Number(rolloverPreviewValue - previewValue) / 1e18).toLocaleString(language, {
                      style: "decimal",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}`}
                  </Text>
                </XStack>
              ) : (
                <Skeleton width="100%" height={40} />
              )}
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <YStack>
                  <Text headline textAlign="left">
                    {t("Current debt")}
                  </Text>
                  <Text secondary footnote textAlign="left">
                    {t("due {{date}}", {
                      date: new Date(borrowMaturity * 1000).toLocaleDateString(language, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      }),
                    })}
                  </Text>
                </YStack>
                <Text primary title3 textAlign="right">
                  {`$${(Number(existingDebtPreviewValue) / 1e18).toLocaleString(language, {
                    style: "decimal",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </Text>
              </XStack>
              <Separator height={1} borderColor="$borderNeutralSoft" paddingVertical="$s2" />
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <YStack flex={1}>
                  <Text headline color="$uiBrandSecondary" textAlign="left">
                    {t("Total after rollover")}
                  </Text>
                  <Text secondary footnote textAlign="left">
                    {new Date(borrowMaturity * 1000).toLocaleDateString(language, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                </YStack>
                <Text title color="$uiBrandSecondary" textAlign="right">
                  {`$${(Number(existingDebtPreviewValue + rolloverPreviewValue) / 1e18).toLocaleString(language, {
                    style: "decimal",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </Text>
              </XStack>
            </YStack>
          </View>
        </ScrollView>
        <View padded paddingBottom={insets.bottom} marginBottom="$s4">
          <RolloverButton
            repayMaturity={BigInt(repayMaturity)}
            borrowMaturity={BigInt(borrowMaturity)}
            borrow={borrow}
          />
        </View>
      </View>
    </SafeView>
  );
}

function RolloverButton({
  repayMaturity,
  borrowMaturity,
  borrow,
}: {
  borrow: {
    maturity: bigint;
    position: { fee: bigint; principal: bigint };
    previewValue: bigint;
  };
  borrowMaturity: bigint;
  repayMaturity: bigint;
}) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const router = useRouter();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const toast = useToastController();

  const slippage = (WAD * 105n) / 100n;
  const maxRepayAssets = (borrow.previewValue * slippage) / WAD;
  const percentage = WAD;

  const { data: proposeSimulation } = useSimulateExaPluginPropose({
    address,
    args: [
      marketUSDCAddress,
      maxRepayAssets,
      ProposalType.RollDebt,
      encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "repayMaturity", type: "uint256" },
              { name: "borrowMaturity", type: "uint256" },
              { name: "maxRepayAssets", type: "uint256" },
              { name: "percentage", type: "uint256" },
            ],
          },
        ],
        [{ repayMaturity, borrowMaturity, maxRepayAssets, percentage }],
      ),
    ],
    query: { enabled: !!address && !!bytecode },
  });

  const {
    data: pendingProposals,
    refetch: refetchPendingProposals,
    isPending: isPendingProposalsPending,
  } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });

  const {
    mutate,
    isPending: isProposeRollDebtPending,
    error: proposeRollDebtError,
  } = useWriteContract({
    mutation: {
      onSuccess: async () => {
        toast.show(t("Processing rollover"), {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "success", preset: "done" },
        });
        await refetchPendingProposals();
        router.dismissTo("/activity");
      },
      onError: (error) => {
        toast.show(t("Rollover failed"), {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        reportError(error);
      },
    },
  });

  const proposeRollDebt = useCallback(() => {
    if (!address) throw new Error("no address");
    if (!proposeSimulation) throw new Error("no propose roll debt simulation");
    mutate(proposeSimulation.request);
  }, [address, proposeSimulation, mutate]);

  const hasProposed = pendingProposals?.some(
    ({ proposal }) =>
      proposal.market === marketUSDCAddress &&
      proposal.proposalType === (ProposalType.RollDebt as number) &&
      proposal.amount === maxRepayAssets,
  );

  const isError =
    proposeRollDebtError &&
    !(
      proposeRollDebtError instanceof ContractFunctionExecutionError &&
      proposeRollDebtError.shortMessage === "User rejected the request."
    );

  const disabled =
    !!isError || isProposeRollDebtPending || isPendingProposalsPending || !proposeSimulation || hasProposed;
  return (
    <Button
      onPress={proposeRollDebt}
      main
      spaced
      outlined
      disabled={disabled}
      backgroundColor={disabled ? "$interactiveDisabled" : "$interactiveBaseBrandSoftDefault"}
      color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
      iconAfter={
        isProposeRollDebtPending ? (
          <Spinner color="$interactiveOnDisabled" />
        ) : (
          <ArrowRight color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"} strokeWidth={2.5} />
        )
      }
      flex={0}
    >
      {t("Confirm rollover")}
    </Button>
  );
}
