import React from "react";
import { useTranslation } from "react-i18next";

import { ChevronRight } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { isBefore } from "date-fns";
import { useBytecode } from "wagmi";

import { exaPreviewerAddress, marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadExaPreviewerPendingProposals, useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import ProposalType, {
  decodeCrossRepayAtMaturity,
  decodeRepayAtMaturity,
  decodeRollDebt,
} from "@exactly/common/ProposalType";
import { WAD } from "@exactly/lib";

import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";
import View from "../shared/View";

export default function OverduePayments({ onSelect }: { onSelect: (maturity: bigint) => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address, query: { enabled: !!address } });
  const { data: pendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });
  const { data: markets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!bytecode, refetchInterval: 30_000 },
  });
  const overduePayments = new Map<bigint, { amount: bigint; discount: number }>();
  if (markets) {
    for (const { market, fixedBorrowPositions } of markets) {
      if (market !== marketUSDCAddress) continue;
      for (const { maturity, previewValue, position } of fixedBorrowPositions) {
        if (!previewValue) continue;
        const positionAmount = position.principal + position.fee;
        if (isBefore(new Date(Number(maturity) * 1000), new Date())) {
          overduePayments.set(maturity, {
            amount: (overduePayments.get(maturity)?.amount ?? 0n) + previewValue,
            discount: Number(WAD - (previewValue * WAD) / positionAmount) / 1e18,
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
          {t("Overdue payments")}
        </Text>
      </XStack>
      <YStack gap="$s6">
        {payments.map(([maturity, { amount, discount }]) => {
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
                onSelect(maturity);
              }}
            >
              <XStack alignItems="center" gap="$s3">
                <YStack gap="$s2">
                  <XStack alignItems="center" gap="$s3">
                    <AssetLogo symbol="USDC" width={12} height={12} />
                    <Text sensitive subHeadline color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                      {(Number(amount) / 1e6).toLocaleString(language, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                  </XStack>
                  <Text caption color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                    {new Date(Number(maturity) * 1000).toLocaleDateString(language, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
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
                    <Text
                      emphasized
                      color="$interactiveOnDisabled"
                      maxFontSizeMultiplier={1}
                      caption2
                      textTransform="uppercase"
                    >
                      {t("Processing")}
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
                    <Text
                      emphasized
                      color="$interactiveOnBaseErrorDefault"
                      maxFontSizeMultiplier={1}
                      caption2
                      textTransform="uppercase"
                    >
                      {t("Penalties {{percent}}", {
                        percent: Math.abs(discount).toLocaleString(language, {
                          style: "percent",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }),
                      })}
                    </Text>
                  </View>
                )}
                <Text
                  emphasized
                  subHeadline
                  color={processing ? "$interactiveOnDisabled" : "$interactiveBaseErrorDefault"}
                >
                  {t("Repay")}
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
