import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Calendar, Check, ChevronDown, Download, FileText } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { MATURITY_INTERVAL } from "@exactly/lib";

import reportError from "../../utils/reportError";
import { downloadStatement, viewStatement } from "../../utils/statement";
import useMarkets from "../../utils/useMarkets";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

import type { ActivityItem } from "../../utils/queryClient";

export default function StatementSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: activity } = useQuery<ActivityItem[]>({ queryKey: ["activity"] });
  const { timestamp } = useMarkets();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number>();
  const [picking, setPicking] = useState(false);

  const options = useMemo(() => {
    if (!activity) return [];
    const now = Number(timestamp);
    const maturities = new Set<number>();
    for (const item of activity) {
      const borrows =
        item.type === "panda"
          ? item.operations.flatMap((operation) => ("borrow" in operation ? [operation.borrow] : []))
          : item.type === "card" && "borrow" in item
            ? [item.borrow]
            : [];
      for (const borrow of borrows) {
        if ("installments" in borrow)
          for (const installment of borrow.installments) maturities.add(installment.maturity);
        else maturities.add(borrow.maturity);
      }
    }
    return [...maturities]
      .filter((m) => m - MATURITY_INTERVAL < now)
      .sort((a, b) => b - a)
      .map((maturity) => ({
        maturity,
        label: new Date(maturity * 1000).toLocaleDateString(language, { year: "numeric", month: "long" }),
      }));
  }, [activity, timestamp, language]);

  const maturity = selected ?? options[0]?.maturity;
  const period = options.find((option) => option.maturity === maturity)?.label;

  function run(action: (maturity: number, filename: string) => Promise<void>) {
    if (maturity === undefined || loading) return;
    setLoading(true);
    action(maturity, `account-statement-${maturity}.pdf`)
      .catch(reportError)
      .finally(() => {
        setLoading(false);
      });
  }

  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s6">
          <YStack gap="$s2">
            <Text emphasized primary headline>
              {t("Download account statement")}
            </Text>
            <Text subHeadline color="$uiNeutralSecondary">
              {t("Select a time period and format.")}
            </Text>
          </YStack>

          <YStack gap="$s5">
            <YStack gap="$s3">
              <XStack
                alignItems="center"
                justifyContent="space-between"
                cursor={options.length > 1 ? "pointer" : "default"}
                onPress={() => {
                  if (options.length > 1) setPicking((value) => !value);
                }}
              >
                <XStack gap="$s3" alignItems="center">
                  <Calendar size={20} color="$uiNeutralSecondary" />
                  <Text emphasized subHeadline>
                    {t("Period")}
                  </Text>
                </XStack>
                <XStack gap="$s2" alignItems="center">
                  <Text emphasized subHeadline color={period ? "$uiNeutralPrimary" : "$uiNeutralSecondary"}>
                    {period ?? t("No statements")}
                  </Text>
                  {options.length > 1 && (
                    <ChevronDown size={20} color="$uiNeutralSecondary" rotate={picking ? "180deg" : "0deg"} />
                  )}
                </XStack>
              </XStack>

              {picking && (
                <YStack gap="$s2">
                  {options.map((option) => {
                    const active = option.maturity === maturity;
                    return (
                      <XStack
                        key={option.maturity}
                        alignItems="center"
                        gap="$s3"
                        padding="$s3"
                        borderRadius="$r3"
                        cursor="pointer"
                        backgroundColor={active ? "$interactiveBaseBrandSoftDefault" : "$backgroundMild"}
                        onPress={() => {
                          setSelected(option.maturity);
                          setPicking(false);
                        }}
                      >
                        <XStack
                          width={20}
                          height={20}
                          borderRadius={10}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor={active ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                        >
                          {active && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                        </XStack>
                        <Text emphasized subHeadline color="$uiNeutralPrimary">
                          {option.label}
                        </Text>
                      </XStack>
                    );
                  })}
                </YStack>
              )}
            </YStack>

            <XStack alignItems="center" justifyContent="space-between">
              <XStack gap="$s3" alignItems="center">
                <FileText size={20} color="$uiNeutralSecondary" />
                <YStack gap="$s1">
                  <Text emphasized subHeadline>
                    {t("Format")}
                  </Text>
                  <Text footnote color="$uiNeutralSecondary">
                    {t("Better for reading or sharing")}
                  </Text>
                </YStack>
              </XStack>
              <XStack gap="$s2" alignItems="center">
                <Text emphasized subHeadline>
                  PDF
                </Text>
                <ChevronDown size={20} color="$uiNeutralSecondary" />
              </XStack>
            </XStack>
          </YStack>

          <YStack gap="$s4">
            <Button
              primary
              loading={loading}
              disabled={maturity === undefined || loading}
              onPress={() => {
                run(downloadStatement);
              }}
            >
              <Button.Text>{t("Download PDF")}</Button.Text>
              <Button.Icon>
                <Download />
              </Button.Icon>
            </Button>
            {maturity !== undefined && (
              <XStack
                justifyContent="center"
                cursor="pointer"
                paddingVertical="$s1"
                onPress={() => {
                  run(viewStatement);
                }}
              >
                <Text emphasized footnote color="$interactiveBaseBrandDefault">
                  {t("View")}
                </Text>
              </XStack>
            )}
            <XStack justifyContent="center" cursor="pointer" paddingVertical="$s1" onPress={onClose}>
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                {t("Close")}
              </Text>
            </XStack>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
