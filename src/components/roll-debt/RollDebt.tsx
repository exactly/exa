import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { ContractFunctionExecutionError, encodeFunctionData } from "viem";
import { useSendCalls } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain, { exaPreviewerAddress, marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import {
  useReadExaPreviewerPendingProposals,
  useReadPreviewerPreviewBorrowAtMaturity,
} from "@exactly/common/generated/hooks";
import ProposalType from "@exactly/common/ProposalType";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";

import SafeView from "../../components/shared/SafeView";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useSimulateProposal from "../../utils/useSimulateProposal";
import exa from "../../utils/wagmi/exa";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";

export default function Pay() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { market: exaUSDC, timestamp } = useAsset(marketUSDCAddress);
  const { success, output: repayMaturity } = safeParse(
    pipe(string(), nonEmpty("no maturity")),
    useLocalSearchParams().maturity,
  );

  const now = Number(timestamp);
  const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  const borrowMaturity = Number(repayMaturity) < now ? nextMaturity : Number(repayMaturity) + MATURITY_INTERVAL;
  const repayLabel = useMemo(
    () =>
      new Date(Number(repayMaturity) * 1000).toLocaleDateString(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [repayMaturity, language],
  );
  const borrowLabel = useMemo(
    () =>
      new Date(borrowMaturity * 1000).toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" }),
    [borrowMaturity, language],
  );
  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(success ? repayMaturity : 0));
  const rolloverMaturityBorrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(borrowMaturity));

  const { data: borrowPreview } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    chainId: chain.id,
    args: [marketUSDCAddress, BigInt(borrowMaturity), borrow?.previewValue ?? 0n],
    query: { enabled: !!exaUSDC && !!borrow && !!address && !!borrowMaturity },
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
        <View flexDirection="row" gap="$s3_5" justifyContent="space-around" alignItems="center">
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
                    {t("due {{date}}", { date: repayLabel })}
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
                              (borrow.previewValue * (borrowPreview.maturity - timestamp)),
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
                    {t("due {{date}}", { date: borrowLabel })}
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
                    {borrowLabel}
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
  const toast = useToastController();

  const slippage = (WAD * 105n) / 100n;
  const maxRepayAssets = (borrow.previewValue * slippage) / WAD;
  const percentage = WAD;

  const { request: proposeSimulation, error: executeProposalError } = useSimulateProposal({
    account: address,
    amount: maxRepayAssets,
    market: marketUSDCAddress,
    proposalType: ProposalType.RollDebt,
    borrowMaturity,
    maxRepayAssets,
    percentage,
    repayMaturity,
    enabled: !!address,
  });

  const {
    data: pendingProposals,
    refetch: refetchPendingProposals,
    isPending: isPendingProposalsPending,
  } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    chainId: chain.id,
    args: address ? [address] : undefined,
    query: { enabled: !!address, gcTime: 0, refetchInterval: 30_000 },
  });

  const { mutateAsync: mutateSendCalls } = useSendCalls();
  const {
    mutate: proposeRollDebt,
    isPending: isProposeRollDebtPending,
    error: proposeRollDebtError,
  } = useMutation({
    async mutationFn() {
      if (!address) throw new Error("no address");
      if (!proposeSimulation) throw new Error("no propose roll debt simulation");
      const { address: to, abi, functionName, args } = proposeSimulation;
      const { id } = await mutateSendCalls({
        chainId: chain.id,
        calls: [{ to, data: encodeFunctionData({ abi, functionName, args }) }],
        capabilities: {
          paymasterService: {
            url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
            context: { policyId: alchemyGasPolicyId },
          },
        },
      });
      const { status } = await waitForCallsStatus(exa, { id });
      if (status === "failure") throw new Error("failed to propose rollover");
    },
    onSuccess() {
      toast.show(t("Processing rollover"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success", preset: "done" },
      });
      if (address) refetchPendingProposals().catch(reportError);
      router.dismissTo("/activity");
    },
    onError(error) {
      toast.show(t("Rollover failed"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
      reportError(error);
    },
  });

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
    !!isError ||
    !!executeProposalError ||
    isProposeRollDebtPending ||
    isPendingProposalsPending ||
    !proposeSimulation ||
    hasProposed;
  return (
    <Button secondary disabled={disabled} loading={isProposeRollDebtPending} onPress={() => proposeRollDebt()}>
      <Button.Text>{t("Confirm rollover")}</Button.Text>
      <Button.Icon>
        <ArrowRight />
      </Button.Icon>
    </Button>
  );
}
