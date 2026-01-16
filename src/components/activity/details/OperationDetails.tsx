import React from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { setStringAsync } from "expo-clipboard";

import { CalendarClock, CreditCard, SquareArrowOutUpRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { format } from "date-fns";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";

import openBrowser from "../../../utils/openBrowser";
import reportError from "../../../utils/reportError";
import Text from "../../shared/Text";

import type { CreditActivity, DebitActivity, InstallmentsActivity } from "@exactly/server/api/activity";

export default function OperationDetails({ item }: { item: CreditActivity | DebitActivity | InstallmentsActivity }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          {t("Purchase details")}
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("ID")}
          </Text>
          <Text
            callout
            color="$uiNeutralPrimary"
            onPress={() => {
              setStringAsync(item.id).catch(reportError);
              Alert.alert(t("Copied!"), t("The operation ID has been copied to the clipboard."));
            }}
            hitSlop={15}
          >
            {shortenHex(item.id)}
          </Text>
        </XStack>

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Total")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {item.usdAmount.toLocaleString(language, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
        </XStack>

        {item.mode !== 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Installments")}
            </Text>
            <Text emphasized callout color="$uiNeutralPrimary">
              {item.mode === 1 &&
                `1x ${(item.usdAmount + item.borrow.fee).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              {item.mode > 1 && `${(item as InstallmentsActivity).borrow.installments.length}x`}&nbsp;
              {item.mode > 1 &&
                (item.usdAmount / (item as InstallmentsActivity).borrow.installments.length).toLocaleString(language, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              &nbsp;USDC
            </Text>
          </XStack>
        )}

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Mode")}
          </Text>
          <XStack alignItems="center" gap="$s2">
            <Text primary callout>
              {item.mode > 0 ? t("Pay Later") : t("Card")}
            </Text>
            {item.mode > 0 ? (
              <CalendarClock size={20} color="$uiBrandPrimary" />
            ) : (
              <CreditCard size={20} color="$uiBrandPrimary" />
            )}
          </XStack>
        </XStack>

        {item.mode > 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Fixed rate APR")}
            </Text>
            <Text callout color="$uiNeutralPrimary">
              {(item as CreditActivity).borrow.rate.toLocaleString(language, {
                style: "percent",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </XStack>
        )}

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Date")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(item.timestamp, "yyyy-MM-dd")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Time")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(item.timestamp, "HH:mm:ss")}
          </Text>
        </XStack>

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Transaction hash")}
          </Text>
          <XStack
            alignItems="center"
            gap="$s3"
            onPress={() => {
              const explorerUrl = chain.blockExplorers?.default.url;
              if (!explorerUrl) return;
              openBrowser(`${explorerUrl}/tx/${item.transactionHash}`).catch(reportError);
            }}
          >
            <Text textDecorationLine="underline" callout color="$uiNeutralPrimary">
              {shortenHex(item.transactionHash)}
            </Text>
            <SquareArrowOutUpRight size={20} color="$uiNeutralSecondary" />
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  );
}
