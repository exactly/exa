import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { MoreHorizontal } from "@tamagui/lucide-icons";
import { XStack } from "tamagui";

import reportError from "../../utils/reportError";
import Text from "../shared/Text";

export default function PaymentRow({ maturity, onSelect }: { maturity: number; onSelect: (maturity: number) => void }) {
  const {
    i18n: { language },
  } = useTranslation();
  const label = format(maturity, language);
  return (
    <XStack
      role="button"
      aria-label={label}
      cursor="pointer"
      alignItems="center"
      gap="$s3"
      onPress={() => {
        selectionAsync().catch(reportError);
        onSelect(maturity);
      }}
    >
      <Text flex={1} emphasized subHeadline color="$uiNeutralPrimary">
        {label}
      </Text>
      <MoreHorizontal size={20} color="$interactiveBaseBrandDefault" />
    </XStack>
  );
}

function format(maturity: number, language: string) {
  return new Date(maturity * 1000).toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric" });
}
