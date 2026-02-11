import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { ChevronRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { isBefore, isToday, isTomorrow } from "date-fns";
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

export default function UpcomingPayments({ onSelect }: { onSelect: (maturity: bigint) => void }) {
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
  const duePayments = new Map<bigint, { amount: bigint; discount: number; positionAmount: bigint }>();
  if (markets) {
    for (const { market, fixedBorrowPositions } of markets) {
      if (market !== marketUSDCAddress) continue;
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
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s5">
      <Text emphasized headline>
        {t("Upcoming payments")}
      </Text>
      <YStack gap="$s4">
        {payments.length > 0 ? (
          payments.map(([maturity, { amount, discount }], index) => {
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
            const maturityDate = new Date(Number(maturity) * 1000);
            return (
              <React.Fragment key={String(maturity)}>
                {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
                <XStack
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
                      {isToday(maturityDate)
                        ? t("Due today")
                        : isTomorrow(maturityDate)
                          ? t("Due tomorrow")
                          : maturityDate.toLocaleDateString(language, {
                              year: "2-digit",
                              month: "short",
                              day: "numeric",
                            })}
                    </Text>
                    {processing ? (
                      <Text footnote color="$interactiveTextDisabled">
                        {t("Processing")}
                      </Text>
                    ) : discount >= 0.001 ? (
                      <Text emphasized footnote color="$uiSuccessSecondary">
                        {t("{{percent}} OFF", {
                          percent: discount.toLocaleString(language, {
                            style: "percent",
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          }),
                        })}
                      </Text>
                    ) : null}
                  </YStack>
                  <Text
                    sensitive
                    emphasized
                    title3
                    color={processing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}
                  >
                    {(Number(amount) / 10 ** (exaUSDC?.decimals ?? 6)).toLocaleString(language, {
                      style: "currency",
                      currency: "USD",
                    })}
                  </Text>
                  <ChevronRight size={20} color={processing ? "$iconDisabled" : "$interactiveBaseBrandDefault"} />
                </XStack>
              </React.Fragment>
            );
          })
        ) : (
          <YStack alignItems="center" justifyContent="center" gap="$s4_5">
            <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
              🎉
            </Text>
            <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
              {t("You're all set!")}
            </Text>
            <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
              {t("Any funding or purchases will show up here.")}
            </Text>
          </YStack>
        )}
        {payments.length > 0 && (
          <Text caption color="$uiNeutralSecondary">
            <Text color="$uiInfoSecondary" emphasized>
              {t("You must repay each installment manually before its due date.")}{" "}
            </Text>
            {t("If not, a {{rate}} penalty is added every day the payment is late.", {
              rate: (exaUSDC ? Number(exaUSDC.penaltyRate * 86_400n) / 1e18 : 0).toLocaleString(language, {
                style: "percent",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }),
            })}
          </Text>
        )}
      </YStack>
    </View>
  );
}
