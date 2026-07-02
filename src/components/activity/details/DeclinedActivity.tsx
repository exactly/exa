import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";

import { AlertTriangle, Copy, ShoppingCart } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Separator, Square, View, XStack, YStack } from "tamagui";

import { format } from "date-fns";
import { getName, registerLocale } from "i18n-iso-countries/index";
import en from "i18n-iso-countries/langs/en.json";
import es from "i18n-iso-countries/langs/es.json";
import pt from "i18n-iso-countries/langs/pt.json";
import { titleCase } from "title-case";

import shortenHex from "@exactly/common/shortenHex";

import reportError from "../../../utils/reportError";
import Image from "../../shared/Image";
import Text from "../../shared/Text";

import type { PandaActivity } from "@exactly/server/api/activity";

registerLocale(en);
registerLocale(es);
registerLocale(pt);

export default function DeclinedActivity({ item }: { item: PandaActivity }) {
  const toast = useToastController();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const amount = `$${Math.abs(item.usdAmount).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const location = titleCase(
    [
      item.merchant.city,
      item.merchant.state,
      item.merchant.country && getName(item.merchant.country, language.split("-")[0] ?? "en"),
    ]
      .filter((field) => field && field !== "null")
      .join(", ")
      .toLowerCase(),
  );
  return (
    <>
      <YStack gap="$s7" paddingBottom="$s7">
        <XStack justifyContent="center" alignItems="center">
          <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
            {item.merchant.icon ? (
              <Image source={{ uri: item.merchant.icon }} width={80} height={80} borderRadius="$r4" />
            ) : (
              <ShoppingCart size={48} color="$uiNeutralPrimary" strokeWidth={2} />
            )}
          </Square>
        </XStack>
        <YStack gap="$s4_5" justifyContent="center" alignItems="center">
          <Text body color="$uiErrorSecondary">
            {t("Failed")}
            <Text emphasized primary body $platform-web={{ whiteSpace: "normal" }}>
              &nbsp;
              {item.merchant.name}
            </Text>
          </Text>
          <Text title strikeThrough color="$uiErrorSecondary">
            {amount}
          </Text>
          {location ? (
            <Text secondary body>
              {location}
            </Text>
          ) : null}
        </YStack>
      </YStack>
      <YStack gap="$s7">
        <XStack borderRadius="$r3" backgroundColor="$interactiveBaseErrorSoftDefault" overflow="hidden">
          <View
            padding="$s4"
            backgroundColor="$interactiveBaseErrorDefault"
            justifyContent="center"
            alignItems="center"
            alignSelf="stretch"
          >
            <AlertTriangle size={32} color="$interactiveOnBaseErrorDefault" />
          </View>
          <View padding="$s4" flex={1} justifyContent="center">
            <Text subHeadline color="$interactiveOnBaseErrorSoft">
              {t("There was an error when processing your payment: {{reason}}", {
                reason: t(item.reason ?? "transaction declined"),
              })}
            </Text>
          </View>
        </XStack>
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
                {t("Amount")}
              </Text>
              <Text callout color="$uiNeutralPrimary">
                {amount}
              </Text>
            </XStack>
            <XStack justifyContent="space-between">
              <Text emphasized footnote color="$uiNeutralSecondary">
                {t("ID")}
              </Text>
              <Pressable
                onPress={() => {
                  setStringAsync(item.id)
                    .then(() => {
                      toast.show(t("Operation ID copied!"), {
                        duration: 1000,
                        burntOptions: { haptic: "success" },
                      });
                    })
                    .catch(reportError);
                }}
                hitSlop={15}
              >
                <XStack gap="$s3">
                  <Text callout color="$uiNeutralPrimary">
                    {shortenHex(item.id)}
                  </Text>
                  <Copy size={20} color="$uiNeutralPrimary" />
                </XStack>
              </Pressable>
            </XStack>
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
          </YStack>
        </YStack>
      </YStack>
    </>
  );
}
