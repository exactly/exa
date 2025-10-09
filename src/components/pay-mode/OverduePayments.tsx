import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";
import { exaPreviewerAddress, previewerAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";
import { ChevronRight } from "@tamagui/lucide-icons";
import { format, isBefore } from "date-fns";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import { useReadExaPreviewerPendingProposals, useReadPreviewerExactly } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function OverduePayments({ onSelect }: { onSelect: (maturity: bigint, amount: bigint) => void }) {
  const { address } = useAccount();
  const {
    data: bytecode,
    isPending: isPendingBytecode,
  } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const {
    data: pendingProposals,
    isPending: isPendingPendingProposals,
    isFetching: isFetchingPendingProposals,
  } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });
  const {
    data: markets,
    isPending: isPendingMarkets,
    isFetching: isFetchingMarkets,
  } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address && !!bytecode, refetchInterval: 30_000 },
  });
  if (!address) return null;
  if (isPendingBytecode) return <PaymentsSkeleton title="Overdue payments" />;
  if (!bytecode) return null;
  const loading =
    isPendingMarkets ||
    isPendingPendingProposals ||
    (isFetchingMarkets && !markets) ||
    (isFetchingPendingProposals && !pendingProposals);
  if (loading) {
    return <PaymentsSkeleton title="Overdue payments" />;
  }
  if (!markets) return null;
  const overduePayments = new Map<bigint, { amount: bigint; discount: number }>();
  for (const { fixedBorrowPositions } of markets) {
    for (const { maturity, previewValue, position } of fixedBorrowPositions) {
      if (!previewValue) continue;
      const positionAmount = position.principal + position.fee;
      if (previewValue === 0n) continue;
      if (isBefore(new Date(Number(maturity) * 1000), new Date())) {
        overduePayments.set(maturity, {
          amount: (overduePayments.get(maturity)?.amount ?? 0n) + previewValue,
          discount: Number(WAD - (previewValue * WAD) / positionAmount) / 1e18,
        });
      }
    }
  }
  const payments = [...overduePayments];
  if (payments.length === 0) return null;
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s6">
      <XStack alignItems="center" justifyContent="space-between">
        <Text emphasized headline flex={1}>
          Overdue payments
        </Text>
      </XStack>
      <YStack gap="$s6">
        {payments.map(([maturity, { amount, discount }], index) => {
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
              key={index}
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
                    <AssetLogo uri={assetLogos.USDC} width={12} height={12} />
                    <Text sensitive subHeadline color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                      {(Number(amount) / 1e6).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  </XStack>
                  <Text caption color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
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
                {processing ? null : (
                  <View
                    alignSelf="center"
                    justifyContent="center"
                    alignItems="center"
                    backgroundColor="$interactiveBaseErrorDefault"
                    borderRadius="$r2"
                    paddingVertical="$s1"
                    paddingHorizontal="$s2"
                  >
                    <Text emphasized color="$interactiveOnBaseErrorDefault" maxFontSizeMultiplier={1} caption2>
                      {`PENALTIES ${(discount >= 0 ? discount : discount * -1).toLocaleString(undefined, {
                        style: "percent",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    </Text>
                  </View>
                )}
                <Text
                  emphasized
                  subHeadline
                  color={processing ? "$interactiveOnDisabled" : "$interactiveBaseErrorDefault"}
                >
                  Repay
                </Text>
                <ChevronRight size={16} color={processing ? "$iconDisabled" : "$interactiveBaseBrandDefault"} />
              </XStack>
            </XStack>
          );
        })}
      </YStack>
    </View>
  );
}

function PaymentsSkeleton({ title, count = 2 }: { title: string; count?: number }) {
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s6">
      <XStack alignItems="center" justifyContent="space-between">
        <Text emphasized headline flex={1}>
          {title}
        </Text>
      </XStack>
      <YStack gap="$s6">
        {Array.from({ length: count }).map((_, index) => (
          <XStack key={index} justifyContent="space-between" alignItems="center">
            <XStack alignItems="center" gap="$s3">
              <YStack gap="$s2">
                <Skeleton height={18} width={80} />
                <Skeleton height={12} width={100} />
              </YStack>
              <Skeleton height={20} width={100} />
            </XStack>
            <XStack alignItems="center" gap="$s3">
              <Skeleton height={20} width={100} />
              <Skeleton height={16} width={16} />
            </XStack>
          </XStack>
        ))}
      </YStack>
    </View>
  );
}
