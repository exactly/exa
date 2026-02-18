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
          {t("Upcoming payments")}
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
                  onSelect(maturity);
                }}
              >
                <XStack alignItems="center" gap="$s3">
                  <YStack gap="$s2">
                    <XStack alignItems="center" gap="$s3">
                      <AssetLogo symbol="USDC" width={12} height={12} />
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
                        {(Number(amount) / 10 ** (exaUSDC?.decimals ?? 6)).toLocaleString(language, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </XStack>
                    <Text caption color={processing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}>
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
                      <Text
                        emphasized
                        color="$interactiveOnBaseSuccessDefault"
                        maxFontSizeMultiplier={1}
                        caption2
                        textTransform="uppercase"
                      >
                        {t("{{discount}} off", {
                          discount: discount.toLocaleString(language, {
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
                    color={processing ? "$interactiveOnDisabled" : "$interactiveBaseBrandDefault"}
                  >
                    {t("Repay")}
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
