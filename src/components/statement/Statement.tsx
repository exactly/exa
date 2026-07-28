import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleCheck, CircleHelp, Coins, CreditCard, Download, FileText } from "@tamagui/lucide-icons";
import { ScrollView, Separator, Spinner, XStack, YStack } from "tamagui";

import { MATURITY_INTERVAL } from "@exactly/lib";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import { downloadStatement, group } from "../../utils/statement";
import useStatement from "../../utils/useStatement";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Statement() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const parameter = useLocalSearchParams().maturity;
  const raw = Array.isArray(parameter) ? parameter[0] : parameter;
  const maturity = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
  const { data, isLoading } = useStatement(maturity);
  const [downloading, setDownloading] = useState(false);

  const money = (value: number) => value.toLocaleString(language, { style: "currency", currency: "USD" });
  const percent = (value: number) =>
    value.toLocaleString(language, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = (value: number | string) =>
    new Date(typeof value === "number" ? value * 1000 : value).toLocaleDateString(language, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

  const period =
    maturity === undefined
      ? undefined
      : t("{{start}} to {{end}}", { start: day(maturity - MATURITY_INTERVAL), end: day(maturity) });

  const { cards, payments, paid, due } = useMemo(() => group(data ?? []), [data]);
  const empty = cards.length === 0 && payments.length === 0;
  const lastCard = cards.length - 1;

  function download() {
    if (maturity === undefined || downloading) return;
    setDownloading(true);
    downloadStatement(maturity, `account-statement-${maturity}.pdf`)
      .catch(reportError)
      .finally(() => {
        setDownloading(false);
      });
  }

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View
        padded
        flexDirection="row"
        gap="$s3_5"
        paddingBottom="$s4"
        justifyContent="space-between"
        alignItems="center"
        backgroundColor="$backgroundSoft"
      >
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            router.back();
          }}
        />
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle("10245778").catch(reportError);
          }}
        />
      </View>
      <View backgroundColor="$backgroundSoft" paddingHorizontal="$s5" paddingBottom="$s5" gap="$s2">
        <XStack justifyContent="space-between" alignItems="center">
          <XStack gap="$s3" alignItems="center">
            <FileText size={20} color="$uiNeutralPrimary" />
            <Text emphasized title3>
              {t("Statement")}
            </Text>
          </XStack>
          {!empty && (
            <XStack gap="$s2" alignItems="center" cursor="pointer" aria-disabled={downloading} onPress={download}>
              <Text emphasized subHeadline color="$interactiveBaseBrandDefault">
                {t("Download")}
              </Text>
              {downloading ? (
                <Spinner color="$interactiveBaseBrandDefault" />
              ) : (
                <Download size={20} color="$interactiveBaseBrandDefault" />
              )}
            </XStack>
          )}
        </XStack>
        {period && (
          <Text footnote color="$uiNeutralSecondary">
            {period}
          </Text>
        )}
      </View>

      <ScrollView backgroundColor="$backgroundSoft" showsVerticalScrollIndicator={false} flex={1}>
        {isLoading ? (
          <YStack padding="$s5" gap="$s3">
            <Skeleton height={48} width="100%" radius={12} />
            <Skeleton height={48} width="100%" radius={12} />
            <Skeleton height={48} width="100%" radius={12} />
            <Skeleton height={48} width="100%" radius={12} />
          </YStack>
        ) : empty ? (
          <YStack flex={1} alignItems="center" justifyContent="center" gap="$s4" paddingVertical="$s7">
            <Text emphasized headline color="$uiNeutralSecondary">
              {t("No statement for this period")}
            </Text>
          </YStack>
        ) : (
          <>
            <YStack paddingHorizontal="$s5" paddingTop="$s3">
              {cards.map((card, index) => (
                <React.Fragment key={card.lastFour}>
                  <TimelineRow node={<CreditCard size={16} color="$uiNeutralPrimary" />} first={index === 0}>
                    <SectionTitle>{t("Card **** {{lastFour}} installments", { lastFour: card.lastFour })}</SectionTitle>
                  </TimelineRow>
                  {card.dates.map((dates) => (
                    <React.Fragment key={dates.key}>
                      <TimelineRow bullet>
                        <Text emphasized caption2 color="$uiNeutralSecondary">
                          {day(dates.label)}
                        </Text>
                      </TimelineRow>
                      {dates.rows.map((row) => (
                        <TimelineRow key={`${row.merchant}-${row.current}-${row.amount}`}>
                          <XStack gap="$s3" alignItems="center">
                            <YStack flex={1} gap="$s1">
                              <Text subHeadline color="$uiNeutralPrimary">
                                {row.merchant}
                              </Text>
                              {row.total > 1 && (
                                <Text footnote color="$uiNeutralSecondary">
                                  {t("Installment {{current}} of {{total}}", {
                                    current: row.current,
                                    total: row.total,
                                  })}
                                </Text>
                              )}
                            </YStack>
                            <Text sensitive subHeadline color="$uiNeutralSecondary">
                              {money(row.amount)}
                            </Text>
                          </XStack>
                        </TimelineRow>
                      ))}
                    </React.Fragment>
                  ))}
                  <TimelineRow
                    node={<CircleCheck size={16} color="$uiBrandSecondary" />}
                    last={payments.length === 0 && index === lastCard}
                  >
                    <XStack gap="$s3" alignItems="center">
                      <YStack flex={1}>
                        <Text emphasized subHeadline color="$uiNeutralPrimary">
                          {t("Total installments")}
                        </Text>
                        <Text footnote color="$uiNeutralSecondary">
                          {t("Card **** {{lastFour}}", { lastFour: card.lastFour })}
                        </Text>
                      </YStack>
                      <Text sensitive emphasized headline color="$uiNeutralPrimary">
                        {money(card.total)}
                      </Text>
                    </XStack>
                  </TimelineRow>
                </React.Fragment>
              ))}

              {payments.length > 0 && (
                <>
                  <TimelineRow node={<Coins size={16} color="$uiNeutralSecondary" />}>
                    <SectionTitle>{t("Payments")}</SectionTitle>
                  </TimelineRow>
                  {payments.map((payment) => {
                    const off =
                      payment.positionAmount > 0
                        ? (payment.positionAmount - payment.amount) / payment.positionAmount
                        : 0;
                    return (
                      <TimelineRow key={payment.id} bullet>
                        <XStack gap="$s3" alignItems="center">
                          <YStack flex={1} gap="$s1">
                            <Text emphasized caption2 color="$uiNeutralSecondary">
                              {day(payment.timestamp)}
                            </Text>
                            {off >= 0.0001 ? (
                              <Text footnote color="$uiSuccessSecondary">
                                {t("{{percent}} OFF", { percent: percent(off) })}
                              </Text>
                            ) : off <= -0.0001 ? (
                              <Text footnote color="$uiErrorSecondary">
                                {t("{{percent}} late fee", { percent: percent(-off) })}
                              </Text>
                            ) : null}
                          </YStack>
                          <Text sensitive subHeadline color="$uiNeutralSecondary">
                            {money(payment.amount)}
                          </Text>
                        </XStack>
                      </TimelineRow>
                    );
                  })}
                  <TimelineRow node={<CircleCheck size={16} color="$uiBrandSecondary" />} last>
                    <XStack gap="$s3" alignItems="center">
                      <Text flex={1} emphasized subHeadline color="$uiNeutralPrimary">
                        {t("Total payments")}
                      </Text>
                      <Text sensitive emphasized headline color="$uiNeutralPrimary">
                        {money(paid)}
                      </Text>
                    </XStack>
                  </TimelineRow>
                </>
              )}
            </YStack>

            <XStack
              backgroundColor="$backgroundStrong"
              paddingHorizontal="$s5"
              paddingVertical="$s4"
              gap="$s3"
              alignItems="center"
            >
              <FileText size={20} color="$uiNeutralPrimary" />
              <Text flex={1} emphasized headline color="$uiNeutralPrimary">
                {t("Total due")}
              </Text>
              <Text sensitive emphasized title3 color="$uiNeutralPrimary">
                {money(due)}
              </Text>
            </XStack>
          </>
        )}
      </ScrollView>
    </SafeView>
  );
}

function TimelineRow({
  node,
  bullet,
  first,
  last,
  children,
}: {
  bullet?: boolean;
  children: React.ReactNode;
  first?: boolean;
  last?: boolean;
  node?: React.ReactNode;
}) {
  return (
    <XStack gap="$s3">
      <YStack width={24} alignItems="center">
        <View
          position="absolute"
          top={first ? 11 : 0}
          bottom={last ? undefined : 0}
          height={last ? 11 : undefined}
          left={11.25}
          width={1.5}
          backgroundColor="$borderNeutralStrong"
        />
        {node ? (
          <YStack
            width={24}
            height={24}
            borderRadius={12}
            backgroundColor="$backgroundSoft"
            alignItems="center"
            justifyContent="center"
          >
            {node}
          </YStack>
        ) : bullet ? (
          <YStack height={22} justifyContent="center">
            <View width={7} height={7} borderRadius={4} backgroundColor="$uiNeutralSecondary" />
          </YStack>
        ) : null}
      </YStack>
      <YStack flex={1} paddingBottom="$s4">
        {children}
      </YStack>
    </XStack>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <XStack alignItems="center" gap="$s3" height={24}>
      <Text emphasized subHeadline color="$uiNeutralPrimary">
        {children}
      </Text>
      <Separator flex={1} borderColor="$borderNeutralStrong" />
    </XStack>
  );
}
