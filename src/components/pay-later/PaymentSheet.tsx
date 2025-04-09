import ProposalType from "@exactly/common/ProposalType";
import { exaPreviewerAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";
import { Coins, Info, RefreshCw } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistance, isAfter } from "date-fns";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback } from "react";
import { Pressable } from "react-native";
import { Sheet, Spinner, XStack } from "tamagui";
import { titleCase } from "title-case";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { encodeAbiParameters, zeroAddress } from "viem";
import { useAccount, useBytecode, useWriteContract } from "wagmi";

import { useReadExaPreviewerPendingProposals, useSimulateExaPluginPropose } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaymentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { presentArticle } = useIntercom();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const { market: USDCMarket } = useAsset(marketUSDCAddress);
  const { maturity: currentMaturity } = useLocalSearchParams();
  const { success, output: maturity } = safeParse(pipe(string(), nonEmpty("no maturity")), currentMaturity);
  if (!success || !USDCMarket) return;

  const { fixedBorrowPositions, usdPrice, decimals } = USDCMarket;
  const borrow = fixedBorrowPositions.find((b) => b.maturity === BigInt(maturity));

  if (!borrow) return;

  const previewValue = (borrow.previewValue * usdPrice) / 10n ** BigInt(decimals);
  const positionValue = ((borrow.position.principal + borrow.position.fee) * usdPrice) / 10n ** BigInt(decimals);
  const discount = Number(WAD - (previewValue * WAD) / positionValue) / 1e18;
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
      snapPointsMode="fit"
      zIndex={100_000}
      modal
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Handle />
      <Sheet.Frame>
        <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
          <View padded paddingTop="$s6" fullScreen flex={1}>
            <>
              <View gap="$s5">
                <XStack alignItems="center" justifyContent="center" gap="$s3">
                  <Text
                    secondary
                    textAlign="center"
                    emphasized
                    subHeadline
                    color={
                      isAfter(new Date(Number(maturity) * 1000), new Date())
                        ? "$uiNeutralSecondary"
                        : "$uiErrorSecondary"
                    }
                  >
                    {titleCase(
                      isAfter(new Date(Number(maturity) * 1000), new Date())
                        ? `Due in ${formatDistance(new Date(), new Date(Number(maturity) * 1000))}`
                        : `${formatDistance(new Date(Number(maturity) * 1000), new Date())} past due`,
                    )}
                    <Text secondary textAlign="center" emphasized subHeadline color="$uiNeutralSecondary">
                      &nbsp;-&nbsp;{format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
                    </Text>
                  </Text>
                  <Pressable
                    onPress={() => {
                      presentArticle("10245778").catch(reportError);
                    }}
                    hitSlop={15}
                  >
                    <Info size={16} color="$uiNeutralPrimary" />
                  </Pressable>
                </XStack>
                <View flexDirection="column" justifyContent="center" alignItems="center" gap="$s4">
                  <Text
                    sensitive
                    textAlign="center"
                    fontFamily="$mono"
                    fontSize={40}
                    overflow="hidden"
                    color={
                      isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralPrimary" : "$uiErrorSecondary"
                    }
                  >
                    {(Number(previewValue) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                  {discount >= 0 && (
                    <Text sensitive body strikeThrough color="$uiNeutralSecondary">
                      {(Number(positionValue) / 1e18).toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        currencyDisplay: "narrowSymbol",
                      })}
                    </Text>
                  )}
                  {!hidden && (
                    <Text
                      pill
                      caption2
                      padding="$s2"
                      backgroundColor={
                        discount >= 0 ? "$interactiveBaseSuccessSoftDefault" : "$interactiveBaseErrorSoftDefault"
                      }
                      color={discount >= 0 ? "$uiSuccessSecondary" : "$uiErrorSecondary"}
                    >
                      {discount >= 0 ? "PAY NOW AND SAVE " : "DAILY PENALTIES "}
                      {(discount >= 0 ? discount : discount * -1).toLocaleString(undefined, {
                        style: "percent",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  )}
                </View>
                <View
                  flexDirection="row"
                  display="flex"
                  gap={10}
                  justifyContent="center"
                  alignItems="center"
                  paddingVertical={10}
                >
                  <Button
                    onPress={() => {
                      onClose();
                      router.push({ pathname: "/pay", params: { maturity: maturity.toString() } });
                    }}
                    contained
                    main
                    spaced
                    halfWidth
                    iconAfter={<Coins color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />}
                  >
                    Repay
                  </Button>
                  <RolloverButton maturity={maturity} borrow={borrow} onClose={onClose} />
                </View>
              </View>
            </>
          </View>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}

function RolloverButton({
  maturity,
  borrow,
  onClose,
}: {
  maturity: string;
  borrow: {
    maturity: bigint;
    previewValue: bigint;
    position: { principal: bigint; fee: bigint };
  };
  onClose: () => void;
}) {
  const { address } = useAccount();
  const toast = useToastController();

  const followingMaturity = Number(maturity) + MATURITY_INTERVAL;
  const repayMaturity = BigInt(maturity);
  const borrowMaturity = BigInt(followingMaturity);

  const slippage = (WAD * 105n) / 100n;
  const maxRepayAssets = (borrow.previewValue * slippage) / WAD;
  const percentage = WAD;

  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
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
    query: { enabled: !!address, gcTime: 0, refetchInterval: 30_000 },
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
        onClose();
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
      halfWidth
      outlined
      disabled={disabled}
      backgroundColor={disabled ? "$interactiveDisabled" : "$interactiveBaseBrandSoftDefault"}
      color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
      iconAfter={
        isProposeRollDebtPending ? (
          <Spinner color="$interactiveOnDisabled" />
        ) : (
          <RefreshCw color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"} strokeWidth={2.5} />
        )
      }
    >
      Rollover
    </Button>
  );
}
