import React, { use, useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { Check } from "@tamagui/lucide-icons-2/icons/Check";
import { Coins } from "@tamagui/lucide-icons-2/icons/Coins";
import { ExternalLink } from "@tamagui/lucide-icons-2/icons/ExternalLink";
import { Eye } from "@tamagui/lucide-icons-2/icons/Eye";
import { EyeOff } from "@tamagui/lucide-icons-2/icons/EyeOff";
import { FileText } from "@tamagui/lucide-icons-2/icons/FileText";
import { Info } from "@tamagui/lucide-icons-2/icons/Info";
import { RefreshCw } from "@tamagui/lucide-icons-2/icons/RefreshCw";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { formatDistanceStrict } from "date-fns";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { WAD } from "@exactly/lib";

import Empty from "./Empty";
import EmptyMessage from "./EmptyMessage";
import HistorySheet from "./HistorySheet";
import OverduePayments from "./OverduePayments";
import PaymentHistory from "./PaymentHistory";
import PaymentSheet from "./PaymentSheet";
import RolloverIntroSheet from "./RolloverIntroSheet";
import UpcomingPayments from "./UpcomingPayments";
import { date } from "../../i18n";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useMarkets from "../../utils/useMarkets";
import usePendingOperations from "../../utils/usePendingOperations";
import useProposalManager from "../../utils/useProposalManager";
import useStatements from "../../utils/useStatements";
import useTabPress from "../../utils/useTabPress";
import TabBarContext from "../context/TabBarContext";
import Amount from "../shared/Amount";
import IconButton from "../shared/IconButton";
import InfoSheet from "../shared/InfoSheet";
import RefreshControl from "../shared/RefreshControl";
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
  const toast = useToastController();
  const proposalManager = useProposalManager();
  const { market: exaUSDC } = useAsset(marketUSDCAddress);
  const { markets, timestamp, refetch } = useMarkets({ refetchInterval: 30_000 });

  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const { data: rolloverIntroShown } = useQuery<boolean>({ queryKey: ["settings", "rollover-intro-shown"] });
  const [rolloverIntroMaturity, setRolloverIntroMaturity] = useState<string>();
  const [historyMaturity, setHistoryMaturity] = useState<number>();
  const [infoType, setInfoType] = useState<"discount" | "fees" | "total" | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const refresh = () =>
    Promise.all([
      refetch(),
      queryClient.invalidateQueries({ queryKey: ["activity"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["activity", "statement"] }),
    ]);
  useTabPress("pay-mode", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh().catch(reportError);
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
          isOverdue: maturity < timestamp,
        });
      }
    }
    return [...map].sort(([a], [b]) => Number(a - b));
  }, [markets, timestamp]);

  const hasPayments = allMaturities.length > 0;
  const statements = useStatements();
  const empty = !hasPayments && statements?.length === 0;
  const firstMaturity = allMaturities[0];

  const { isProcessing } = usePendingOperations();

  const totalOutstandingUSD = useMemo(() => {
    if (!exaUSDC) return 0;
    const total = allMaturities.reduce((sum, [, { previewValue }]) => sum + previewValue, 0n);
    return Number(total) / 10 ** exaUSDC.decimals;
  }, [allMaturities, exaUSDC]);

  const viewStatement = useCallback(() => {
    if (firstMaturity) router.navigate({ pathname: "/statement", params: { maturity: String(firstMaturity[0]) } });
  }, [router, firstMaturity]);

  const onSelect = useCallback(
    (maturity: bigint) => {
      router.setParams({ maturity: String(maturity) });
    },
    [router],
  );

  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor={empty ? "$backgroundSoft" : "$backgroundMild"}>
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={scrollRef}
          backgroundColor="transparent"
          contentContainerStyle={{
            flexGrow: 1,
            paddingBottom: use(TabBarContext),
            backgroundColor: empty ? "$backgroundSoft" : "$backgroundMild",
          }}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={<RefreshControl onRefresh={refresh} />}
        >
          {empty ? (
            <Empty />
          ) : (
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
              <IconButton
                icon={hidden ? EyeOff : Eye}
                color="$uiNeutralSecondary"
                aria-label={hidden ? t("Show sensitive") : t("Hide sensitive")}
                onPress={() => {
                  queryClient.setQueryData(["settings", "sensitive"], !hidden);
                }}
              />
            </XStack>
          )}
          {hasPayments && (
            <>
              <TotalOutstandingCard
                amount={totalOutstandingUSD}
                count={allMaturities.length}
                t={t}
                onInfoPress={() => setInfoType("total")}
              />
              <View padded paddingTop="$s5" gap="$s5">
                {firstMaturity && exaUSDC && (
                  <FirstMaturityCard
                    maturity={firstMaturity[0]}
                    summary={firstMaturity[1]}
                    decimals={exaUSDC.decimals}
                    language={language}
                    processing={isProcessing(firstMaturity[0])}
                    t={t}
                    onInfoPress={() => setInfoType(firstMaturity[1].isOverdue ? "fees" : "discount")}
                    onPay={() => router.navigate({ pathname: "/pay", params: { maturity: String(firstMaturity[0]) } })}
                    onViewStatement={viewStatement}
                    onRollover={() => {
                      if (rolloverIntroShown) {
                        if (!proposalManager) {
                          toast.show(t("Upgrade account to rollover"), {
                            duration: 1000,
                            burntOptions: { haptic: "error", preset: "error" },
                          });
                          return;
                        }
                        router.navigate({ pathname: "/roll-debt", params: { maturity: String(firstMaturity[0]) } });
                        return;
                      }
                      setRolloverIntroMaturity(String(firstMaturity[0]));
                    }}
                  />
                )}
                <OverduePayments excludeMaturity={firstMaturity?.[0]} onSelect={onSelect} />
                <UpcomingPayments excludeMaturity={firstMaturity?.[0]} onSelect={onSelect} />
              </View>
              <PaymentSheet onRolloverIntro={setRolloverIntroMaturity} />
              <RolloverIntroSheet
                maturity={rolloverIntroMaturity}
                onClose={() => setRolloverIntroMaturity(undefined)}
              />
              <InfoSheet open={infoType === "total"} onClose={() => setInfoType(null)} title={t("Total outstanding")}>
                <Text body color="$uiNeutralSecondary">
                  {t("This total includes all your purchases, loans, interest, and any applicable late fees.")}
                </Text>
                <Button primary onPress={() => setInfoType(null)}>
                  <Button.Text>{t("Got it!")}</Button.Text>
                  <Button.Icon>
                    <Check />
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
                    <ExternalLink />
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
                    <ExternalLink />
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
          )}
          {!empty && (
            <YStack paddingHorizontal="$s4" paddingTop={hasPayments ? "$s4" : "$s6"} paddingBottom="$s6" gap="$s6">
              {!hasPayments && (
                <View
                  backgroundColor="$backgroundSoft"
                  borderRadius="$r3"
                  paddingHorizontal="$s4"
                  paddingTop="$s4"
                  paddingBottom="$s5"
                  shadowColor="$backgroundStrong"
                  shadowOffset={{ width: 0, height: 6 }}
                  shadowOpacity={0.6}
                  shadowRadius={28}
                >
                  <EmptyMessage
                    emoji="🎉"
                    title={t("No payments pending")}
                    description={t("Payments from Pay Later purchases will appear here.")}
                  />
                </View>
              )}
              <PaymentHistory onSelect={setHistoryMaturity} />
            </YStack>
          )}
        </ScrollView>
      </View>
      <HistorySheet maturity={historyMaturity} onClose={() => setHistoryMaturity(undefined)} />
    </SafeView>
  );
}

function TotalOutstandingCard({
  amount,
  count,
  onInfoPress,
  t,
}: {
  amount: number;
  count: number;
  onInfoPress: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <View backgroundColor="$backgroundSoft" paddingHorizontal="$s6" paddingTop="$s4" paddingBottom="$s5" gap="$s4">
      <XStack gap="$s3" justifyContent="space-between" alignItems="center">
        <XStack gap="$s2" alignItems="center">
          <Text emphasized headline>
            {t("Total outstanding")}
          </Text>
          <IconButton
            icon={Info}
            size={16}
            color="$interactiveBaseBrandDefault"
            aria-label={t("Total outstanding info")}
            onPress={onInfoPress}
          />
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
  processing,
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
  processing: boolean;
  summary: { isOverdue: boolean; positionAmount: bigint; previewValue: bigint };
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { previewValue, positionAmount, isOverdue } = summary;
  const { timestamp } = useMarkets();
  const maturityDate = useMemo(() => new Date(Number(maturity) * 1000), [maturity]);
  const now = useMemo(() => new Date(Number(timestamp) * 1000), [timestamp]);
  const timeDistance = formatDistanceStrict(isOverdue ? maturityDate : now, isOverdue ? now : maturityDate, {
    locale: date(),
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
          {processing ? (
            <Text emphasized subHeadline color="$interactiveTextDisabled">
              {t("Processing")}
            </Text>
          ) : isOverdue ? (
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
        <IconButton
          icon={Info}
          size={16}
          color="$interactiveBaseBrandDefault"
          aria-label={t("Payment info")}
          onPress={onInfoPress}
        />
      </XStack>
      <View padding="$s4">
        <XStack gap="$s3">
          <Button primary flex={1} disabled={processing} onPress={onPay}>
            <Button.Text>{t("Pay")}</Button.Text>
            <Button.Icon>
              <Coins />
            </Button.Icon>
          </Button>
          <Button secondary flex={1} disabled={processing} onPress={onRollover}>
            <Button.Text>{t("Rollover")}</Button.Text>
            <Button.Icon>
              <RefreshCw />
            </Button.Icon>
          </Button>
        </XStack>
      </View>
    </View>
  );
}
