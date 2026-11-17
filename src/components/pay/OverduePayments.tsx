import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { Separator, XStack, YStack } from "tamagui";

import chain, { alchemyChains, marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";

import { ChevronRight } from "../../generated/icons/ChevronRight";
import reportError from "../../utils/reportError";
import useDebts from "../../utils/useDebts";
import useMarkets from "../../utils/useMarkets";
import usePendingOperations from "../../utils/usePendingOperations";
import Text from "../shared/Text";
import View from "../shared/View";

export default function OverduePayments({
  exclude,
  onSelect,
}: {
  exclude?: { chainId: number; maturity: bigint };
  onSelect: (maturity: bigint, chainId: number) => void;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { isProcessing } = usePendingOperations();
  const { markets } = useMarkets({ refetchInterval: 30_000 });
  const exaUSDC = markets?.find(({ market }) => market === marketUSDCAddress);
  const { debts = [] } = useDebts({ refetchInterval: 30_000 });
  const payments = debts.filter(
    ({ chainId, maturity, overdue }) => overdue && (maturity !== exclude?.maturity || chainId !== exclude.chainId),
  );
  if (payments.length === 0) return null;
  return (
    <View backgroundColor="backgroundSoft" borderRadius="r3" overflow="hidden">
      <XStack padding="s4">
        <Text emphasized headline>
          {t("Overdue payments")}
        </Text>
      </XStack>
      <YStack role="list" paddingHorizontal="s4" paddingBottom="s4" paddingTop="s3_5" gap="s4">
        {payments.map(({ chainId, maturity, previewValue, position }, index) => {
          const processing = isProcessing(maturity, chainId);
          const discount = Number(WAD - (previewValue * WAD) / position) / 1e18;
          const formattedDate = new Date(Number(maturity) * 1000).toLocaleDateString(language, {
            year: "2-digit",
            month: "short",
            day: "numeric",
          });
          const formattedAmount = `$${(Number(previewValue) / 10 ** (exaUSDC?.decimals ?? 6)).toLocaleString(language, {
            style: "decimal",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
          return (
            <React.Fragment key={`${chainId}:${maturity}`}>
              {index > 0 && <Separator borderColor="borderNeutralSoft" />}
              <XStack
                aria-label={formattedDate}
                role="button"
                aria-disabled={processing}
                cursor="pointer"
                alignItems="center"
                gap="s3"
                onPress={() => {
                  if (processing) return;
                  selectionAsync().catch(reportError);
                  onSelect(maturity, chainId);
                }}
              >
                <YStack flex={1} gap="s2">
                  <Text emphasized subHeadline color={processing ? "interactiveTextDisabled" : "uiNeutralPrimary"}>
                    {formattedDate}
                  </Text>
                  {chainId !== chain.id && (
                    <Text footnote color="uiNeutralSecondary">
                      {alchemyChains.get(chainId)?.name}
                    </Text>
                  )}
                  <Text emphasized footnote color={processing ? "interactiveTextDisabled" : "uiErrorSecondary"}>
                    {processing
                      ? t("Processing")
                      : `+${Math.abs(discount).toLocaleString(language, {
                          style: "percent",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}`}
                  </Text>
                </YStack>
                <Text sensitive emphasized title3 color={processing ? "interactiveTextDisabled" : "uiErrorSecondary"}>
                  {formattedAmount}
                </Text>
                <ChevronRight size={20} color={processing ? "iconDisabled" : "interactiveBaseBrandDefault"} />
              </XStack>
            </React.Fragment>
          );
        })}
        <Text caption color="uiNeutralSecondary">
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
