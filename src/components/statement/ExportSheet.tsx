import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { setStringAsync } from "expo-clipboard";

import { ChevronRight } from "@tamagui/lucide-icons-2/icons/ChevronRight";
import { Download } from "@tamagui/lucide-icons-2/icons/Download";
import { LetterText } from "@tamagui/lucide-icons-2/icons/LetterText";
import { Table } from "@tamagui/lucide-icons-2/icons/Table";
import { Upload } from "@tamagui/lucide-icons-2/icons/Upload";
import { useToastController } from "@tamagui/toast";
import { Separator, XStack, YStack } from "tamagui";

import { format } from "date-fns";

import reportError from "../../utils/reportError";
import { downloadStatement } from "../../utils/statement";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

import type statement from "../../utils/statement";

export default function ExportSheet({
  open,
  onClose,
  maturity,
  period,
  data: { cards, payments, paid, due },
}: {
  data: ReturnType<typeof statement>;
  maturity: number;
  onClose: () => void;
  open: boolean;
  period: string;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const toast = useToastController();

  const money = (value: number) => value.toLocaleString(language, { style: "currency", currency: "USD" });
  const number = (value: number) =>
    value.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false });
  const percent = (value: number) =>
    value.toLocaleString(language, { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const day = (value: string) =>
    new Date(value).toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric" });
  const fee = ({ amount, positionAmount }: (typeof payments)[number]) => {
    const off = positionAmount > 0 ? (positionAmount - amount) / positionAmount : 0;
    if (off >= 0.0001) return t("{{percent}} OFF", { percent: percent(off) });
    if (off <= -0.0001) return t("{{percent}} late fee", { percent: percent(-off) });
  };

  function text() {
    const lines = [t("Statement"), period];
    for (const card of cards) {
      lines.push("", t("Card **** {{lastFour}} installments", { lastFour: card.lastFour }));
      for (const { label, rows } of card.dates) {
        for (const row of rows) {
          lines.push(
            [
              day(label),
              row.merchant,
              row.total > 1 && t("Installment {{current}} of {{total}}", { current: row.current, total: row.total }),
              money(row.amount),
            ]
              .filter(Boolean)
              .join(" · "),
          );
        }
      }
      lines.push(`${t("Total installments")}: ${money(card.total)}`);
    }
    if (payments.length > 0) {
      lines.push("", t("Payments"));
      for (const payment of payments) {
        lines.push([day(payment.timestamp), fee(payment), money(-payment.positionAmount)].filter(Boolean).join(" · "));
      }
      lines.push(`${t("Total payments")}: ${money(-paid)}`);
    }
    lines.push("", `${t("Total due")}: ${money(due)}`);
    return lines.join("\n");
  }

  function table() {
    const rows = [[t("Date"), t("Card"), t("Merchant"), t("Installments"), t("Amount")]];
    for (const card of cards) {
      for (const { key, rows: items } of card.dates) {
        for (const row of items) {
          rows.push([
            key,
            `**** ${card.lastFour}`,
            cell(row.merchant),
            `${row.current}/${row.total}`,
            number(row.amount),
          ]);
        }
      }
    }
    for (const payment of payments) {
      const label = fee(payment);
      rows.push([
        format(payment.timestamp, "yyyy-MM-dd"),
        "",
        label ? `${t("Payment")} · ${label}` : t("Payment"),
        "",
        number(-payment.positionAmount),
      ]);
    }
    rows.push(["", "", t("Total due"), "", number(due)]);
    return rows.map((row) => row.join("\t")).join("\n");
  }

  function copy(value: string) {
    setStringAsync(value)
      .then(() => {
        toast.show(t("Copied!"), { duration: 1000, burntOptions: { haptic: "success" } });
      })
      .catch(reportError);
    onClose();
  }

  function download() {
    onClose();
    downloadStatement(maturity).catch((error: unknown) => {
      reportError(error);
      toast.show(t("Couldn't download your statement. Please try again."), {
        burntOptions: { haptic: "error", preset: "error" },
      });
    });
  }

  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView
        paddingTop={0}
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-web={{ paddingBottom: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <XStack gap="$s4" alignItems="center" paddingTop="$s6" paddingBottom="$s4_5" paddingHorizontal="$s5">
          <XStack
            width={48}
            height={48}
            alignItems="center"
            justifyContent="center"
            borderRadius="$r4"
            backgroundColor="$backgroundStrong"
          >
            <Upload size={32} color="$uiSuccessSecondary" />
          </XStack>
          <YStack flex={1} gap="$s2">
            <Text body color="$uiNeutralSecondary">
              <Trans
                i18nKey="Export <strong>statement</strong>"
                components={{ strong: <Text body emphasized color="$uiNeutralPrimary" /> }}
              />
            </Text>
            <Text caption color="$uiNeutralSecondary">
              {period}
            </Text>
          </YStack>
        </XStack>
        <Separator borderColor="$borderNeutralSoft" />
        <YStack gap="$s4_5" paddingTop="$s4_5" paddingHorizontal="$s5">
          <Option
            icon={LetterText}
            label={t("Copy as plain text")}
            description={t("Paste as text in a chat, mail or notes")}
            onPress={() => {
              copy(text());
            }}
          />
          <Separator borderColor="$borderNeutralSoft" />
          <Option
            icon={Table}
            label={t("Copy as a table")}
            description={t("Paste on Excel or Google Sheets")}
            onPress={() => {
              copy(table());
            }}
          />
          {Platform.OS === "web" && (
            <>
              <Separator borderColor="$borderNeutralSoft" />
              <Option icon={Download} label={t("Download PDF")} onPress={download} />
            </>
          )}
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}

function Option({
  icon: Icon,
  label,
  description,
  onPress,
}: {
  description?: string;
  icon: typeof Download;
  label: string;
  onPress: () => void;
}) {
  return (
    <XStack gap="$s3" alignItems="center" cursor="pointer" role="button" aria-label={label} onPress={onPress}>
      <Icon size={20} color="$uiNeutralPrimary" />
      <YStack flex={1}>
        <Text subHeadline color="$uiNeutralPrimary">
          {label}
        </Text>
        {description && (
          <Text footnote color="$uiNeutralSecondary">
            {description}
          </Text>
        )}
      </YStack>
      <ChevronRight size={20} color="$interactiveBaseBrandDefault" />
    </XStack>
  );
}

function cell(value: string) {
  const text = value.replaceAll(/[\t\r\n]+/g, " ").trim();
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
