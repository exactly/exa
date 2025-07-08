import { ChevronRight, AlertTriangle } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { View, Text } from "tamagui";

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
      gap={10}
      flex={1}
    >
      <View
        padding={25}
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

      <View gap={10} padding={25} flex={1}>
        <Text fontSize={15} color="$interactiveOnBaseErrorSoft">
          {t("Some of your assets are at risk of being liquidated.")}
        </Text>
        <Pressable
          onPress={() => {
            presentArticle("9975910").catch(reportError);
          }}
        >
          <View flexDirection="row" gap={2} alignItems="center">
            <Text color="$interactiveOnBaseErrorSoft" fontSize={15} lineHeight={18} fontWeight="bold">
              {t("Learn more")}
            </Text>
            <ChevronRight size={14} color="$interactiveOnBaseErrorSoft" fontWeight="bold" />
          </View>
        </Pressable>
      </View>
    </View>
  );
}
