import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";
import { exaPreviewerAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadExaPreviewerPendingProposals, useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { WAD } from "@exactly/lib";
import { ChevronRight } from "@tamagui/lucide-icons";
import { format, isBefore } from "date-fns";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";
import View from "../shared/View";

export default function UpcomingPayments({ onSelect }: { onSelect: (maturity: bigint, amount: bigint) => void }) {
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: pendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });
  const { data: markets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address && !!bytecode, refetchInterval: 30_000 },
  });
  const duePayments = new Map<bigint, { positionAmount: bigint; amount: bigint; discount: number }>();
  if (markets) {
    for (const { fixedBorrowPositions } of markets) {
      for (const { maturity, previewValue, position } of fixedBorrowPositions) {
        if (!previewValue) continue;

        if (isBefore(new Date(Number(maturity) * 1000), new Date())) continue;
        duePayments.set(maturity, {
          positionAmount: position.principal + position.fee,
          amount: (duePayments.get(maturity)?.amount ?? 0n) + previewValue,
          discount: Number(WAD - (previewValue * WAD) / (position.principal + position.fee)) / 1e18,
        });
      }
    }
  }
  const payments = [...duePayments];
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s6">
      <XStack alignItems="center" justifyContent="space-between">
        <Text emphasized headline flex={1}>
          Upcoming payments
        </Text>
      </XStack>
      <YStack gap="$s6">
        {payments.length > 0 ? (
          payments.map(([maturity, { amount, discount }]) => {
            const isRepaying = pendingProposals?.some(({ proposal }) => {
              const { proposalType: type, data } = proposal;
              const isRepayProposal =
                type === (ProposalType.RepayAtMaturity as number) ||
                type === (ProposalType.CrossRepayAtMaturity as number);
              if (!isRepayProposal) return false;
              const decoded =
                type === (ProposalType.RepayAtMaturity as number)
                  ? decodeRepayAtMaturity(data)
                  : decodeCrossRepayAtMaturity(data);
              return decoded.maturity === maturity;
            });
            const isRollingDebt = pendingProposals?.some(({ proposal }) => {
              const { proposalType: type, data } = proposal;
              if (type !== (ProposalType.RollDebt as number)) return false;
              const decoded = decodeRollDebt(data);
              return decoded.repayMaturity === maturity;
            });
            const processing = isRepaying || isRollingDebt; //eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
            return (
              <XStack
                key={String(maturity)}
                cursor="pointer"
                justifyContent="space-between"
                alignItems="center"
                onPress={() => {
                  if (processing) return;
                  onSelect(maturity, amount);
                }}
              >
                <XStack alignItems="center" gap="$s3">
                  <YStack gap="$s2">
                    <XStack alignItems="center" gap="$s3">
                      <AssetLogo source={{ uri: assetLogos.USDC }} width={12} height={12} />
                      <Text
                        sensitive
                        subHeadline
                        color={
                          processing
                            ? "$interactiveTextDisabled"
                            : discount >= 0
                              ? "$interactiveBaseSuccessDefault"
                              : "$uiNeutralPrimary"
                        }
                      >
                        {(Number(amount) / 1e6).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </XStack>
                    <Text caption color={processing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}>
                      {format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
                    </Text>
                  </YStack>
                  {processing ? (
                    <View
                      alignSelf="center"
                      justifyContent="center"
                      alignItems="center"
                      backgroundColor="$interactiveDisabled"
                      borderRadius="$r2"
                      paddingVertical="$s1"
                      paddingHorizontal="$s2"
                    >
                      <Text emphasized color="$interactiveOnDisabled" maxFontSizeMultiplier={1} caption2>
                        PROCESSING
                      </Text>
                    </View>
                  ) : null}
                </XStack>
                <XStack alignItems="center" gap="$s3">
                  {processing || discount < 0.001 ? null : (
                    <View
                      alignSelf="center"
                      justifyContent="center"
                      alignItems="center"
                      backgroundColor="$interactiveBaseSuccessDefault"
                      borderRadius="$r2"
                      paddingVertical="$s1"
                      paddingHorizontal="$s2"
                    >
                      <Text emphasized color="$interactiveOnBaseSuccessDefault" maxFontSizeMultiplier={1} caption2>
                        {`${discount.toLocaleString(undefined, {
                          style: "percent",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })} OFF`}
                      </Text>
                    </View>
                  )}
                  <Text
                    emphasized
                    subHeadline
                    color={processing ? "$interactiveOnDisabled" : "$interactiveBaseBrandDefault"}
                  >
                    Repay
                  </Text>
                  <ChevronRight size={16} color={processing ? "$iconDisabled" : "$iconBrandDefault"} />
                </XStack>
              </XStack>
            );
          })
        ) : (
          <YStack alignItems="center" justifyContent="center" gap="$s4_5">
            <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
              🎉
            </Text>
            <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
              You&apos;re all set!
            </Text>
            <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
              Any funding or purchases will show up here.
            </Text>
          </YStack>
        )}
        {payments.length > 0 && (
          <Text caption color="$uiNeutralSecondary">
            <Text color="$uiInfoSecondary" emphasized>
              You must repay each installment manually before its due date.&nbsp;
            </Text>
            If not, a 0.45% penalty is added every day the payment is late.
          </Text>
        )}
      </YStack>
    </View>
  );
}
