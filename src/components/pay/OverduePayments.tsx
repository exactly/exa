import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { ChevronRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { useBytecode } from "wagmi";

import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";

import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useMarkets from "../../utils/useMarkets";
import usePendingOperations from "../../utils/usePendingOperations";
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
  const { data: bytecode } = useBytecode({ address, chainId: chain.id, query: { enabled: !!address } });
  const { isProcessing } = usePendingOperations();
  const { markets, timestamp } = useMarkets({ enabled: !!bytecode, refetchInterval: 30_000 });
  const exaUSDC = markets?.find(({ market }) => market === marketUSDCAddress);
  const overdueMaturities = new Map<bigint, { totalPosition: bigint; totalPreview: bigint }>();
  if (markets) {
    for (const { market, fixedBorrowPositions } of markets) {
      if (market !== marketUSDCAddress) continue;
      for (const { maturity, previewValue, position } of fixedBorrowPositions) {
        if (!previewValue) continue;
        if (maturity === excludeMaturity) continue;
        if (maturity < timestamp) {
          const positionAmount = position.principal + position.fee;
          if (positionAmount === 0n) continue;
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
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" overflow="hidden">
      <XStack padding="$s4">
        <Text emphasized headline>
          {t("Overdue payments")}
        </Text>
      </XStack>
      <YStack role="list" paddingHorizontal="$s4" paddingBottom="$s4" paddingTop="$s3_5" gap="$s4">
        {payments.map(([maturity, { amount, discount }], index) => {
          const processing = isProcessing(maturity);
          const formattedDate = new Date(Number(maturity) * 1000).toLocaleDateString(language, {
            year: "2-digit",
            month: "short",
            day: "numeric",
          });
          const formattedAmount = `$${(Number(amount) / 10 ** (exaUSDC?.decimals ?? 6)).toLocaleString(language, {
            style: "decimal",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
          return (
            <React.Fragment key={String(maturity)}>
              {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
              <XStack
                aria-label={formattedDate}
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
        <Text caption color="$uiNeutralSecondary" textAlign="justify">
          <Text emphasized>{t("You must repay each installment manually before its due date.")} </Text>
          {t("If not, a {{rate}} penalty is added every day the payment is late.", {
            rate: (exaUSDC ? Number(exaUSDC.penaltyRate * 86_400n) / 1e18 : 0).toLocaleString(language, {
              style: "percent",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          })}
        </Text>
      </YStack>
    </View>
  );
}
