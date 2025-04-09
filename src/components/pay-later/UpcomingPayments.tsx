import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";
import { exaPreviewerAddress, previewerAddress } from "@exactly/common/generated/chain";
import { ChevronRight } from "@tamagui/lucide-icons";
import { format } from "date-fns";
import React from "react";
import { Pressable } from "react-native";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadExaPreviewerPendingProposals, useReadPreviewerExactly } from "../../generated/contracts";
import Text from "../shared/Text";
import View from "../shared/View";

export default function UpcomingPayments({ onSelect }: { onSelect: (maturity: bigint, amount: bigint) => void }) {
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const { data: pendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: {
      enabled: !!address,
      gcTime: 0,
      refetchInterval: 30_000,
    },
  });
  const duePayments = new Map<bigint, bigint>();
  if (markets) {
    for (const { fixedBorrowPositions, usdPrice, decimals } of markets) {
      for (const { maturity, previewValue } of fixedBorrowPositions) {
        if (!previewValue) continue;
        duePayments.set(
          maturity,
          (duePayments.get(maturity) ?? 0n) + (previewValue * usdPrice) / 10n ** BigInt(decimals),
        );
      }
    }
  }
  const payments = [...duePayments];
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s6">
      <View flexDirection="row" gap="$s3" alignItems="center" justifyContent="space-between">
        <Text emphasized headline flex={1}>
          Upcoming payments
        </Text>
      </View>
      {payments.length > 0 ? (
        payments.map(([maturity, amount], index) => {
          const isRepaying = pendingProposals?.some(({ proposal }) => {
            const { proposalType: type, data } = proposal;
            const isRepayProposal =
              type === Number(ProposalType.RepayAtMaturity) || type === Number(ProposalType.CrossRepayAtMaturity);
            if (!isRepayProposal) return false;
            const decoded =
              type === Number(ProposalType.RepayAtMaturity)
                ? decodeRepayAtMaturity(data)
                : decodeCrossRepayAtMaturity(data);
            return decoded.maturity === maturity;
          });
          const isRollingDebt = pendingProposals?.some(({ proposal }) => {
            const { proposalType: type, data } = proposal;
            if (type !== Number(ProposalType.RollDebt)) return false;
            const decoded = decodeRollDebt(data);
            return decoded.repayMaturity === maturity;
          });
          const isProcessing = isRepaying || isRollingDebt; //eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
          return (
            <Pressable
              key={index}
              disabled={isProcessing}
              onPress={() => {
                if (isProcessing) return;
                onSelect(maturity, amount);
              }}
            >
              <XStack justifyContent="space-between" alignItems="center">
                <XStack alignItems="center" gap="$s3">
                  <Text subHeadline color={isProcessing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}>
                    {format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
                  </Text>
                  {isProcessing && (
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
                  )}
                </XStack>
                <XStack alignItems="center" gap="$s2">
                  <Text sensitive emphasized body color={isRepaying ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}>
                    {(Number(amount) / 1e18).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                  <ChevronRight size={24} color={isRepaying ? "$iconDisabled" : "$iconBrandDefault"} />
                </XStack>
              </XStack>
            </Pressable>
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
            Any purchases made with Pay Later will show up here.
          </Text>
        </YStack>
      )}
    </View>
  );
}
