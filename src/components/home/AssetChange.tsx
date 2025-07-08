import { Minus } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { View, Text } from "tamagui";

export default function AssetChange() {
  const { t } = useTranslation();
  return (
    <View display="flex" flexDirection="row" alignItems="center" justifyContent="center" gap={5}>
      <Minus size={20} color="$uiNeutralSecondary" fontWeight="bold" />
      <Text fontSize={15} fontFamily="$mono" lineHeight={21} textAlign="center" color="$uiNeutralSecondary">
        $0
      </Text>
      <Text fontSize={15} fontFamily="$mono" lineHeight={21} textAlign="center" color="$uiNeutralSecondary">
        (0%)
      </Text>
      <Text fontSize={15} fontFamily="$mono" lineHeight={21} textAlign="center" color="$uiNeutralSecondary">
        {t("7D")}
      </Text>
    </View>
  );
}
