import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { ChevronRight } from "@tamagui/lucide-icons-2";
import { Separator, XStack, YStack } from "tamagui";

import { addDays, isSameDay } from "date-fns";
import { useBytecode } from "wagmi";

import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { maxV, WAD } from "@exactly/lib";

import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useMarkets from "../../utils/useMarkets";
import usePendingOperations from "../../utils/usePendingOperations";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "viem";

export default function UpcomingPayments({
  exclude,
  onSelect,
  showEmpty,
}: {
  exclude?: { market: Address; maturity: bigint };
  onSelect: (market: Address, maturity: bigint) => void;
  showEmpty?: boolean;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address, chainId: chain.id, query: { enabled: !!address } });
  const { isProcessing } = usePendingOperations();
  const { markets, timestamp } = useMarkets({ enabled: !!bytecode, refetchInterval: 30_000 });
  const blockDate = React.useMemo(() => new Date(Number(timestamp) * 1000), [timestamp]);
  const payments = (markets ?? [])
    .flatMap(({ market, symbol, decimals, usdPrice, penaltyRate, fixedBorrowPositions }) =>
      fixedBorrowPositions.flatMap(({ maturity, previewValue, position }) => {
        const positionAmount = position.principal + position.fee;
        if (previewValue === 0n || positionAmount === 0n || maturity < timestamp) return [];
        if (market === exclude?.market && maturity === exclude.maturity) return [];
        return [
          {
            market,
            maturity,
            symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3),
            amount: (previewValue * usdPrice) / 10n ** BigInt(decimals),
            discount: Number(WAD - (previewValue * WAD) / positionAmount) / 1e18,
            penaltyRate,
          },
        ];
      }),
    )
    .sort((a, b) => Number(a.maturity - b.maturity));
  if (payments.length === 0) {
    if (!showEmpty) return null;
    return (
      <View backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s5">
        <Text emphasized headline>
          {t("Upcoming payments")}
        </Text>
        <YStack alignItems="center" justifyContent="center" gap="$s4_5">
          <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
            💳
          </Text>
          <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
            {t("No payments due")}
          </Text>
          <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
            {t("When you pay later with your card or borrow, your payments will show up here.")}
          </Text>
        </YStack>
      </View>
    );
  }
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" overflow="hidden">
      <XStack padding="$s4">
        <Text emphasized headline>
          {t("Upcoming payments")}
        </Text>
      </XStack>
      <YStack role="list" paddingHorizontal="$s4" paddingBottom="$s4" paddingTop="$s3_5" gap="$s4">
        {payments.map(({ market, maturity, symbol, amount, discount }, index) => {
          const processing = isProcessing(market, maturity);
          const maturityDate = new Date(Number(maturity) * 1000);
          const formattedDate = isSameDay(maturityDate, blockDate)
            ? t("Due today")
            : isSameDay(maturityDate, addDays(blockDate, 1))
              ? t("Due tomorrow")
              : maturityDate.toLocaleDateString(language, { year: "2-digit", month: "short", day: "numeric" });
          const formattedAmount = `$${(Number(amount) / 1e18).toLocaleString(language, {
            style: "decimal",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`;
          return (
            <React.Fragment key={`${market}:${maturity}`}>
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
                  onSelect(market, maturity);
                }}
              >
                <YStack flex={1} gap="$s2">
                  <Text emphasized subHeadline color={processing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}>
                    {formattedDate}
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
                <XStack alignItems="center" gap="$s2">
                  {market !== marketUSDCAddress && <AssetLogo symbol={symbol} width={16} height={16} />}
                  <Text
                    sensitive
                    emphasized
                    title3
                    color={processing ? "$interactiveTextDisabled" : "$uiNeutralPrimary"}
                  >
                    {formattedAmount}
                  </Text>
                </XStack>
                <ChevronRight size={20} color={processing ? "$iconDisabled" : "$interactiveBaseBrandDefault"} />
              </XStack>
            </React.Fragment>
          );
        })}
        <Text caption color="$uiNeutralSecondary">
          <Text emphasized>{t("You must repay each installment manually before its due date.")} </Text>
          {t("If not, a {{rate}} penalty is added every day the payment is late.", {
            rate: (Number(maxV(payments.map(({ penaltyRate }) => penaltyRate)) * 86_400n) / 1e18).toLocaleString(
              language,
              {
                style: "percent",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              },
            ),
          })}
        </Text>
      </YStack>
    </View>
  );
}
