import React from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Platform } from "react-native";

import { Share } from "@tamagui/lucide-icons-2";

import Button from "./StyledButton";

export default function ShareButton({ disabled, onPress }: { disabled?: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  if (Platform.OS === "web" && !("share" in navigator)) return null;
  return (
    <Button secondary flex={1} disabled={disabled} onPress={onPress}>
      <Button.Text>{t("Share")}</Button.Text>
      <Button.Icon>
        <Share size={18 * PixelRatio.getFontScale()} />
      </Button.Icon>
    </Button>
  );
}
