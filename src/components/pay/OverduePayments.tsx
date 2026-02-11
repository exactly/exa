import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { ChevronRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

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

import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import Text from "../shared/Text";
import View from "../shared/View";

export default function OverduePayments({
  excludeMaturity,
  onSelect,
}: {
  excludeMaturity?: bigint;
  onSelect: (maturity: bigint) => void;
}) {
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
  const exaUSDC = markets?.find(({ market }) => market === marketUSDCAddress);
  const overdueMaturities = new Map<bigint, { totalPosition: bigint; totalPreview: bigint }>();
  if (markets) {
    for (const { market, fixedBorrowPositions } of markets) {
      if (market !== marketUSDCAddress) continue;
      for (const { maturity, previewValue, position } of fixedBorrowPositions) {
        if (!previewValue) continue;
        if (maturity === excludeMaturity) continue;
        if (isBefore(new Date(Number(maturity) * 1000), new Date())) {
          const positionAmount = position.principal + position.fee;
          const existing = overdueMaturities.get(maturity);
          overdueMaturities.set(maturity, {
            totalPreview: (existing?.totalPreview ?? 0n) + previewValue,
            totalPosition: (existing?.totalPosition ?? 0n) + positionAmount,
          });
        }
      }
    }
  }
  const payments = [...overdueMaturities].map(
    ([maturity, { totalPreview, totalPosition }]) =>
      [
        maturity,
        {
          amount: totalPreview,
          discount: Number(WAD - (totalPreview * WAD) / totalPosition) / 1e18,
        },
      ] as const,
  );
  if (payments.length === 0) return null;
  return (
    <View
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      overflow="hidden"
      shadowColor="$uiNeutralSecondary"
      shadowOffset={{ width: 0, height: 2 }}
      shadowOpacity={0.15}
      shadowRadius={8}
    >
      <XStack padding="$s4">
        <Text emphasized headline>
          {t("Overdue payments")}
        </Text>
      </XStack>
      <YStack paddingHorizontal="$s4" paddingBottom="$s4" paddingTop="$s3_5" gap="$s4">
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
          const processing = isRepaying || isRollingDebt; // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
          const formattedDate = new Date(Number(maturity) * 1000).toLocaleDateString(language, {
            year: "2-digit",
            month: "short",
            day: "numeric",
          });
          const formattedAmount = (Number(amount) / 10 ** (exaUSDC?.decimals ?? 6)).toLocaleString(language, {
            style: "currency",
            currency: "USD",
          });
          return (
            <React.Fragment key={String(maturity)}>
              {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
              <XStack
                aria-label={t("{{date}}, {{amount}}", { date: formattedDate, amount: formattedAmount })}
                role="button"
                aria-disabled={processing}
                cursor="pointer"
                alignItems="center"
                gap="$s3"
                onPress={() => {
                  if (processing) return;
                  selectionAsync().catch(reportError);
                  onSelect(maturity);
                }}
              >
                <YStack flex={1} gap="$s2">
                  <Text emphasized subHeadline color={processing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}>
                    {formattedDate}
                  </Text>
                  <Text emphasized footnote color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                    {processing
                      ? t("Processing")
                      : `+${Math.abs(discount).toLocaleString(language, {
                          style: "percent",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                  </Text>
                </YStack>
                <Text sensitive emphasized title3 color={processing ? "$interactiveTextDisabled" : "$uiErrorSecondary"}>
                  {formattedAmount}
                </Text>
                <ChevronRight size={20} color={processing ? "$iconDisabled" : "$interactiveBaseBrandDefault"} />
              </XStack>
            </React.Fragment>
          );
        })}
      </YStack>
    </View>
  );
}
