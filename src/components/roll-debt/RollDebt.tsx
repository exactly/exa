import ProposalType from "@exactly/common/ProposalType";
import { exaPreviewerAddress, marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";
import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { format } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import { Skeleton } from "moti/skeleton";
import React, { useCallback } from "react";
import { Appearance, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { encodeAbiParameters, zeroAddress } from "viem";
import { useAccount, useBytecode, useWriteContract } from "wagmi";

import SafeView from "../../components/shared/SafeView";
import Text from "../../components/shared/Text";
import View from "../../components/shared/View";
import {
  useReadExaPreviewerPendingProposals,
  useReadPreviewerPreviewBorrowAtMaturity,
  useSimulateExaPluginPropose,
} from "../../generated/contracts";
import useAsset from "../../utils/useAsset";
import Button from "../shared/Button";

export default function Pay() {
  const { address } = useAccount();
  const insets = useSafeAreaInsets();
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const { success, output: maturity } = safeParse(
    pipe(string(), nonEmpty("no maturity")),
    useLocalSearchParams().maturity,
  );

  const timestamp = Math.floor(Date.now() / 1000);
  const rolloverMaturity = Number(maturity) + MATURITY_INTERVAL;
  const borrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(success ? maturity : 0));
  const rolloverMaturityBorrow = exaUSDC?.fixedBorrowPositions.find((b) => b.maturity === BigInt(rolloverMaturity));

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });

  const { data: borrowPreview } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [exaUSDC?.market ?? zeroAddress, BigInt(rolloverMaturity), borrow?.previewValue ?? 0n],
    query: { enabled: !!bytecode && !!exaUSDC && !!borrow && !!address && !!rolloverMaturity },
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
              onPress={() => {
                router.back();
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flex: 1, justifyContent: "space-between" }} // eslint-disable-line react-native/no-inline-styles
        >
          <View padded>
            <Text emphasized title3 textAlign="left">
              Review rollover
            </Text>
            <YStack gap="$s4" paddingTop="$s5">
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <YStack>
                  <Text headline textAlign="left">
                    Debt to rollover
                  </Text>
                  <Text secondary footnote textAlign="left">
                    due {format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
                  </Text>
                </YStack>
                <Text primary title3 textAlign="right">
                  {(Number(previewValue) / 1e18).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
              </XStack>
              {borrowPreview ? (
                <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                  <YStack>
                    <Text headline textAlign="left">
                      Rollover interest
                    </Text>
                    <Text secondary footnote textAlign="left">
                      {`${(
                        Number(
                          ((borrowPreview.assets - borrow.previewValue) * WAD * 31_536_000n) /
                            (borrow.previewValue * (borrowPreview.maturity - BigInt(timestamp))),
                        ) / 1e18
                      ).toLocaleString(undefined, {
                        style: "percent",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })} APR`}
                    </Text>
                  </YStack>
                  <Text primary title3 textAlign="right">
                    {(Number(rolloverPreviewValue - previewValue) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                </XStack>
              ) : (
                <Skeleton width="100%" height={40} colorMode={Appearance.getColorScheme() ?? "light"} />
              )}
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <YStack>
                  <Text headline textAlign="left">
                    Current debt
                  </Text>
                  <Text secondary footnote textAlign="left">
                    due {format(new Date(Number(rolloverMaturity) * 1000), "MMM dd, yyyy")}
                  </Text>
                </YStack>
                <Text primary title3 textAlign="right">
                  {(Number(existingDebtPreviewValue) / 1e18).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
              </XStack>
              <Separator height={1} borderColor="$borderNeutralSoft" paddingVertical="$s2" />
              <XStack justifyContent="space-between" gap="$s3" alignItems="center">
                <YStack>
                  <Text headline color="$uiBrandSecondary" textAlign="left">
                    Total after rollover
                  </Text>
                  <Text secondary footnote textAlign="left">
                    {format(new Date(Number(rolloverMaturity) * 1000), "MMM dd, yyyy")}
                  </Text>
                </YStack>
                <Text title color="$uiBrandSecondary" textAlign="right">
                  {(Number(existingDebtPreviewValue + rolloverPreviewValue) / 1e18).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
              </XStack>
            </YStack>
          </View>
        </ScrollView>
        <View padded paddingBottom={insets.bottom} marginBottom="$s4">
          <RolloverButton maturity={maturity} followingMaturity={rolloverMaturity} borrow={borrow} />
        </View>
      </View>
    </SafeView>
  );
}

function RolloverButton({
  maturity,
  followingMaturity,
  borrow,
}: {
  maturity: string;
  followingMaturity: number;
  borrow: {
    maturity: bigint;
    previewValue: bigint;
    position: { principal: bigint; fee: bigint };
  };
}) {
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const toast = useToastController();

  const repayMaturity = BigInt(maturity);
  const borrowMaturity = BigInt(followingMaturity);

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
    writeContract,
    isPending: isProposeRollDebtPending,
    error: proposeRollDebtError,
  } = useWriteContract({
    mutation: {
      onSuccess: async () => {
        toast.show("Processing rollover", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "success", preset: "done" },
        });
        await refetchPendingProposals();
        router.replace("/(app)/pending-proposals");
      },
      onError: (error) => {
        toast.show("Rollover failed", {
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
    writeContract(proposeSimulation.request);
  }, [address, proposeSimulation, writeContract]);

  const hasProposed = pendingProposals?.some(
    ({ proposal }) =>
      proposal.market === marketUSDCAddress &&
      proposal.proposalType === Number(ProposalType.RollDebt) &&
      proposal.amount === maxRepayAssets,
  );
  const disabled =
    Boolean(proposeRollDebtError) ||
    isProposeRollDebtPending ||
    isPendingProposalsPending ||
    !proposeSimulation ||
    hasProposed;
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
      Confirm rollover
    </Button>
  );
}
