import React, { type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { XStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import Text from "./Text";

export default function Amount({
  amount,
  children,
  label,
  status = "neutral",
  ...properties
}: ComponentPropsWithoutRef<typeof XStack> & {
  amount?: number;
  label?: string;
  status?: "danger" | "neutral" | "success";
}) {
  const {
    i18n: { language },
  } = useTranslation();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const formatted =
    amount === undefined
      ? undefined
      : amount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const { color, wholeColor } = palette[status];

  if (!formatted) {
    return (
      <XStack alignItems="center" position="relative" {...properties}>
        {children}
      </XStack>
    );
  }

  const whole = formatted.slice(0, -3) || "0";
  const decimal = formatted.slice(-3);
  const web = Platform.OS === "web";
  const a11y = hidden ? "***" : (label ?? `$${formatted}`);

  return (
    <XStack
      alignItems="center"
      position="relative"
      overflow="hidden"
      aria-label={web ? undefined : a11y}
      tabIndex={0}
      {...properties}
    >
      <Text
        sensitive
        aria-label={web ? a11y : undefined}
        aria-hidden={!web}
        position="absolute"
        opacity={0}
        pointerEvents="none"
      >
        {`$${formatted}`}
      </Text>
      <Text
        aria-hidden
        fontSize={17}
        lineHeight={17}
        color={color}
        maxFontSizeMultiplier={1}
        $platform-ios={{ marginBottom: 4 }}
      >
        $
      </Text>
      <Text
        aria-hidden
        sensitive
        maxFontSizeMultiplier={1}
        numberOfLines={1}
        fontSize={36}
        color={wholeColor}
        lineHeight={36}
      >
        {whole}
      </Text>
      <Text
        aria-hidden
        sensitive
        fontSize={17}
        lineHeight={17}
        color={color}
        maxFontSizeMultiplier={1}
        alignSelf="flex-start"
        marginTop={2}
        $platform-ios={{ marginTop: 0 }}
      >
        {decimal}
      </Text>
    </XStack>
  );
}

const palette = {
  neutral: { color: "$uiNeutralSecondary", wholeColor: undefined },
  danger: { color: "$uiErrorTertiary", wholeColor: "$uiErrorSecondary" },
  success: { color: "$uiSuccessTertiary", wholeColor: "$uiSuccessSecondary" },
};
