import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl } from "react-native";

import { useRouter } from "expo-router";

import { Check, Coins, ExternalLink, Eye, EyeOff, FileText, Info, RefreshCw } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { formatDistance, isBefore } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { optimismSepolia } from "viem/chains";

import chain, { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { WAD } from "@exactly/lib";

import Empty from "./Empty";
import OverduePayments from "./OverduePayments";
import PaymentSheet from "./PaymentSheet";
import UpcomingPayments from "./UpcomingPayments";
import { presentArticle } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useTabPress from "../../utils/useTabPress";
import Amount from "../shared/Amount";
import InfoSheet from "../shared/InfoSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Pay() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { account, market: exaUSDC } = useAsset(marketUSDCAddress);
  const {
    data: markets,
    refetch,
    isPending,
  } = useReadPreviewerExactly({
    address: previewerAddress,
    args: account ? [account] : undefined,
    query: { enabled: !!account, refetchInterval: 30_000 },
  });

  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const [infoType, setInfoType] = useState<"discount" | "fees" | "total" | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const refresh = useCallback(() => {
    refetch().catch(reportError);
    queryClient.invalidateQueries({ queryKey: ["activity"], exact: true }).catch(reportError);
  }, [refetch]);
  useTabPress("pay-mode", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh();
  });

  const allMaturities = useMemo(() => {
    if (!markets) return [];
    const map = new Map<bigint, { isOverdue: boolean; positionAmount: bigint; previewValue: bigint }>();
    for (const { market, fixedBorrowPositions } of markets) {
      if (market !== marketUSDCAddress) continue;
      for (const { maturity, previewValue, position } of fixedBorrowPositions) {
        if (!previewValue) continue;
        const positionAmount = position.principal + position.fee;
        const existing = map.get(maturity);
        map.set(maturity, {
          previewValue: (existing?.previewValue ?? 0n) + previewValue,
          positionAmount: (existing?.positionAmount ?? 0n) + positionAmount,
          isOverdue: isBefore(new Date(Number(maturity) * 1000), new Date()),
        });
      }
    }
    return [...map].sort(([a], [b]) => Number(a - b));
  }, [markets]);

  const hasPayments = allMaturities.length > 0;
  const firstMaturity = allMaturities[0];

  const totalOutstandingUSD = useMemo(() => {
    if (!exaUSDC) return 0;
    const total = allMaturities.reduce((sum, [, { previewValue }]) => sum + previewValue, 0n);
    return Number(total) / 10 ** exaUSDC.decimals;
  }, [allMaturities, exaUSDC]);

  const viewStatement = useCallback(() => {
    openBrowser(
      `https://${{ [optimismSepolia.id]: "testnet" }[chain.id] ?? "app"}.exact.ly/dashboard?account=${account}&tab=b`,
    ).catch(reportError);
  }, [account]);

  const onSelect = useCallback(
    (maturity: bigint) => {
      router.setParams({ maturity: String(maturity) });
    },
    [router],
  );

  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor={hasPayments ? "$backgroundMild" : "$backgroundSoft"}>
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={scrollRef}
          backgroundColor="transparent"
          contentContainerStyle={{ flexGrow: 1, backgroundColor: hasPayments ? "$backgroundMild" : "$backgroundSoft" }}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={<RefreshControl refreshing={isPending} onRefresh={refresh} />}
        >
          {hasPayments ? (
            <>
              <XStack
                backgroundColor="$backgroundSoft"
                paddingHorizontal="$s4"
                paddingVertical="$s3"
                justifyContent="space-between"
                alignItems="center"
              >
                <Text emphasized title3>
                  {t("Payments")}
                </Text>
                <Pressable
                  aria-label={hidden ? t("Show sensitive") : t("Hide sensitive")}
                  onPress={() => {
                    queryClient.setQueryData(["settings", "sensitive"], !hidden);
                  }}
                  hitSlop={15}
                >
                  {hidden ? <EyeOff color="$uiNeutralSecondary" /> : <Eye color="$uiNeutralSecondary" />}
                </Pressable>
              </XStack>
              <TotalOutstandingCard
                amount={totalOutstandingUSD}
                count={allMaturities.length}
                t={t}
                onInfoPress={() => setInfoType("total")}
                onStatementsPress={viewStatement}
              />
              <View padded paddingTop="$s5" gap="$s5">
                {firstMaturity && exaUSDC && (
                  <FirstMaturityCard
                    maturity={firstMaturity[0]}
                    summary={firstMaturity[1]}
                    decimals={exaUSDC.decimals}
                    language={language}
                    t={t}
                    onInfoPress={() => setInfoType(firstMaturity[1].isOverdue ? "fees" : "discount")}
                    onPay={() => onSelect(firstMaturity[0])}
                    onViewStatement={viewStatement}
                    onRollover={() => {
                      router.setParams({ maturity: String(firstMaturity[0]) });
                    }}
                  />
                )}
                <OverduePayments excludeMaturity={firstMaturity?.[0]} onSelect={onSelect} />
                <UpcomingPayments excludeMaturity={firstMaturity?.[0]} onSelect={onSelect} />
              </View>
              <PaymentSheet />
              <InfoSheet open={infoType === "total"} onClose={() => setInfoType(null)} title={t("Total outstanding")}>
                <Text body color="$uiNeutralSecondary">
                  {t("This total includes all your purchases, loans, interest, and any applicable late fees.")}
                </Text>
                <Button primary onPress={() => setInfoType(null)}>
                  <Button.Text>{t("Got it!")}</Button.Text>
                  <Button.Icon>
                    <Check color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
                  </Button.Icon>
                </Button>
              </InfoSheet>
              <InfoSheet
                open={infoType === "discount"}
                onClose={() => setInfoType(null)}
                title={t("Early repayment discount")}
              >
                <Text body color="$uiNeutralSecondary">
                  {t(
                    "You can repay early and save on interest. The final amount updates automatically before you confirm.",
                  )}
                </Text>
                <Button
                  primary
                  onPress={() => {
                    presentArticle("10245778").catch(reportError);
                  }}
                >
                  <Button.Text>{t("Learn more")}</Button.Text>
                  <Button.Icon>
                    <ExternalLink color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
                  </Button.Icon>
                </Button>
                <Text
                  footnote
                  emphasized
                  color="$interactiveTextBrandDefault"
                  cursor="pointer"
                  textAlign="center"
                  onPress={() => setInfoType(null)}
                >
                  {t("Close")}
                </Text>
              </InfoSheet>
              <InfoSheet open={infoType === "fees"} onClose={() => setInfoType(null)} title={t("Late payment fees")}>
                <Text body color="$uiNeutralSecondary">
                  {t(
                    "Late fees are charged daily after the due date. The rate applies to your full balance (principal + interest) and keeps adding up until you pay.",
                  )}
                </Text>
                <Text emphasized body color="$uiNeutralSecondary">
                  {t("Example: On a $100 balance, a 0.45% daily fee adds $0.45 per day.")}
                </Text>
                <Button
                  primary
                  onPress={() => {
                    presentArticle("10245778").catch(reportError);
                  }}
                >
                  <Button.Text>{t("Learn more")}</Button.Text>
                  <Button.Icon>
                    <ExternalLink color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
                  </Button.Icon>
                </Button>
                <Text
                  footnote
                  emphasized
                  color="$interactiveTextBrandDefault"
                  cursor="pointer"
                  textAlign="center"
                  onPress={() => setInfoType(null)}
                >
                  {t("Close")}
                </Text>
              </InfoSheet>
            </>
          ) : (
            <Empty />
          )}
        </ScrollView>
      </View>
    </SafeView>
  );
}

function TotalOutstandingCard({
  amount,
  count,
  onInfoPress,
  onStatementsPress,
  t,
}: {
  amount: number;
  count: number;
  onInfoPress: () => void;
  onStatementsPress: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <View backgroundColor="$backgroundSoft" paddingHorizontal="$s6" paddingTop="$s4" paddingBottom="$s5" gap="$s4">
      <XStack gap="$s3" justifyContent="space-between" alignItems="center">
        <XStack gap="$s2" alignItems="center">
          <Text emphasized headline>
            {t("Total outstanding")}
          </Text>
          <Pressable onPress={onInfoPress} hitSlop={15}>
            <Info size={16} color="$interactiveBaseBrandDefault" />
          </Pressable>
        </XStack>
        <XStack gap="$s1" alignItems="center" cursor="pointer" onPress={onStatementsPress}>
          <Text emphasized footnote color="$interactiveBaseBrandDefault">
            {t("Statements")}
          </Text>
          <FileText size={16} color="$interactiveBaseBrandDefault" />
        </XStack>
      </XStack>
      <XStack justifyContent="space-between" alignItems="center">
        <Amount amount={amount} />
        {count > 0 && (
          <Text body color="$uiNeutralSecondary">
            {t("in {{count}} payments", { count })}
          </Text>
        )}
      </XStack>
    </View>
  );
}

function FirstMaturityCard({
  summary,
  decimals: assetDecimals,
  language,
  maturity,
  onInfoPress,
  onPay,
  onRollover,
  onViewStatement,
  t,
}: {
  decimals: number;
  language: string;
  maturity: bigint;
  onInfoPress: () => void;
  onPay: () => void;
  onRollover: () => void;
  onViewStatement: () => void;
  summary: { isOverdue: boolean; positionAmount: bigint; previewValue: bigint };
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { previewValue, positionAmount, isOverdue } = summary;
  const maturityDate = new Date(Number(maturity) * 1000);
  const now = new Date();
  const dateFnsLocale = language === "es" ? es : enUS;
  const timeDistance = formatDistance(isOverdue ? maturityDate : now, isOverdue ? now : maturityDate, {
    locale: dateFnsLocale,
  });

  const discount = Number(WAD - (previewValue * WAD) / positionAmount) / 1e18;
  const penaltyPercent = isOverdue ? Math.abs(discount) : discount;
  const originalAmount = Number(positionAmount) / 10 ** assetDecimals;

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
      <YStack padding="$s4" gap="$s1">
        <XStack gap="$s3" alignItems="center">
          <XStack gap="$s2" alignItems="center" flex={1}>
            <Text emphasized headline color={isOverdue ? "$uiErrorSecondary" : "$uiNeutralPrimary"}>
              {isOverdue
                ? t("{{time}} past due", { time: timeDistance })
                : t("Due in {{time}}", { time: timeDistance })}
            </Text>
          </XStack>
          <XStack gap="$s1" alignItems="center" cursor="pointer" onPress={onViewStatement}>
            <Text emphasized footnote color="$interactiveBaseBrandDefault">
              {t("View statement")}
            </Text>
            <FileText size={16} color="$interactiveBaseBrandDefault" />
          </XStack>
        </XStack>
        <Text caption color="$uiNeutralSecondary">
          {maturityDate.toLocaleDateString(language, { year: "numeric", month: "short", day: "numeric" })}
          {` - ${maturityDate.toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`}
        </Text>
      </YStack>
      <XStack padding="$s4" gap="$s3_5" alignItems="center">
        <Amount
          amount={Number(previewValue) / 10 ** assetDecimals}
          status={isOverdue ? "danger" : "success"}
          flex={1}
        />
        <YStack alignItems="flex-end" gap="$s3">
          {isOverdue ? (
            <>
              <Text sensitive body color="$uiErrorSecondary">
                {penaltyPercent.toLocaleString(language, {
                  style: "percent",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
              <Text emphasized subHeadline color="$uiErrorSecondary">
                {t("Late payment fee")}
              </Text>
            </>
          ) : discount >= 0.001 ? (
            <>
              <Text sensitive body strikeThrough color="$uiNeutralSecondary">
                {`$${originalAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
              <Text emphasized subHeadline color="$uiSuccessSecondary">
                {t("{{percent}} OFF", {
                  percent: discount.toLocaleString(language, {
                    style: "percent",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  }),
                })}
              </Text>
            </>
          ) : null}
        </YStack>
        <Pressable onPress={onInfoPress} hitSlop={15}>
          <Info size={16} color="$interactiveBaseBrandDefault" />
        </Pressable>
      </XStack>
      <View padding="$s4">
        <XStack gap="$s3">
          <Button primary flex={1} onPress={onPay}>
            <Button.Text>{t("Pay")}</Button.Text>
            <Button.Icon>
              <Coins color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
            </Button.Icon>
          </Button>
          <Button secondary flex={1} onPress={onRollover}>
            <Button.Text>{t("Rollover")}</Button.Text>
            <Button.Icon>
              <RefreshCw color="$interactiveOnBaseBrandSoft" strokeWidth={2.5} />
            </Button.Icon>
          </Button>
        </XStack>
      </View>
    </View>
  );
}
