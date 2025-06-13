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
import { useAccount, useBytecode } from "wagmi";

import { useReadExaPreviewerPendingProposals, useReadPreviewerExactly } from "../../generated/contracts";
import Text from "../shared/Text";
import View from "../shared/View";

export default function OverduePayments({ onSelect }: { onSelect: (maturity: bigint, amount: bigint) => void }) {
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
  const overduePayments = new Map<bigint, { amount: bigint; discount: number }>();
  if (markets) {
    for (const { fixedBorrowPositions, usdPrice, decimals } of markets) {
      for (const { maturity, previewValue, position } of fixedBorrowPositions) {
        if (!previewValue) continue;
        const previewValueUSD = (previewValue * usdPrice) / 10n ** BigInt(decimals);
        const positionAmountUSD = ((position.principal + position.fee) * usdPrice) / 10n ** BigInt(decimals);
        if (previewValueUSD === 0n) continue;
        if (isBefore(new Date(Number(maturity) * 1000), new Date())) {
          overduePayments.set(maturity, {
            amount: (overduePayments.get(maturity)?.amount ?? 0n) + previewValueUSD,
            discount: Number(WAD - (previewValueUSD * WAD) / positionAmountUSD) / 1e18,
          });
        }
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
          const processing = isRepaying || isRollingDebt; //eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
          return (
            <XStack
              cursor="pointer"
              key={index}
              justifyContent="space-between"
              alignItems="center"
              onPress={() => {
                if (processing) return;
                onSelect(maturity, amount);
              }}
            >
              <YStack gap="$s2">
                <Text subHeadline color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                  {(Number(amount) / 1e18).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
                <Text caption color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                  {format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
                </Text>
              </YStack>
              <XStack alignItems="center" gap="$s3">
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
                ) : (
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
