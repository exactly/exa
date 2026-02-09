import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { AlertTriangle, ChevronRight } from "@tamagui/lucide-icons";
import { Text, View } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";

export default function LiquidationAlert() {
  const { t } = useTranslation();
  return (
    <View
      borderRadius="$r6"
      flexDirection="row"
      backgroundColor="$interactiveBaseErrorSoftDefault"
      justifyContent="space-between"
      alignItems="center"
      gap="$s3_5"
      flex={1}
    >
      <View
        padding="$s5"
        backgroundColor="$interactiveBaseErrorDefault"
        justifyContent="center"
        alignItems="center"
        borderTopLeftRadius="$r6"
        borderBottomLeftRadius="$r6"
        width="20%"
        height="100%"
      >
        <AlertTriangle size={32} color="$interactiveOnBaseErrorDefault" />
      </View>

      <View gap="$s3_5" padding="$s5" flex={1}>
        <Text fontSize={15} color="$interactiveOnBaseErrorSoft">
          {t("Some of your assets are at risk of being liquidated.")}
        </Text>
        <Pressable
          onPress={() => {
            presentArticle("9975910").catch(reportError);
          }}
        >
          <View flexDirection="row" gap="$s1" alignItems="center">
            <Text color="$interactiveOnBaseErrorSoft" fontSize={15} fontWeight="bold">
              {t("Learn more")}
            </Text>
            <ChevronRight size={14} color="$interactiveOnBaseErrorSoft" fontWeight="bold" />
          </View>
        </Pressable>
      </View>
    </View>
  );
}
