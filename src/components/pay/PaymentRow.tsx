import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { MoreHorizontal } from "@tamagui/lucide-icons-2";

import reportError from "../../utils/reportError";
import Button from "../shared/StyledButton";

export default function PaymentRow({ maturity, onSelect }: { maturity: number; onSelect: (maturity: number) => void }) {
  const {
    i18n: { language },
  } = useTranslation();
  const label = new Date(maturity * 1000).toLocaleDateString(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <Button
      transparent
      aria-label={label}
      gap="$s3"
      minHeight={0}
      paddingHorizontal={0}
      onPress={() => {
        selectionAsync().catch(reportError);
        onSelect(maturity);
      }}
    >
      <Button.Text color="$uiNeutralPrimary">{label}</Button.Text>
      <Button.Icon>
        <MoreHorizontal size={20} color="$interactiveBaseBrandDefault" />
      </Button.Icon>
    </Button>
  );
}
