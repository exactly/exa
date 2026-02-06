import React, { type ComponentPropsWithoutRef } from "react";
import { useTranslation } from "react-i18next";

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
  const whole = formatted?.slice(0, -3).replace(/^$/, "0");
  const decimal = formatted?.slice(-3);
  const displayLabel = hidden ? undefined : (label ?? (formatted ? `$${formatted}` : undefined));
  const { color, wholeColor } = palette[status];

  return (
    <XStack
      alignItems="center"
      position="relative"
      {...(displayLabel ? { "aria-label": displayLabel, tabIndex: 0 } : undefined)}
      {...(whole ? { overflow: "hidden" } : undefined)}
      {...properties}
    >
      {whole ? (
        <>
          <Text aria-hidden position="absolute" opacity={0} fontSize={1} pointerEvents="none">
            {displayLabel}
          </Text>
          <Text fontSize={17} lineHeight={36} color={color}>
            $
          </Text>
          <Text
            sensitive
            maxFontSizeMultiplier={1}
            numberOfLines={1}
            adjustsFontSizeToFit
            fontSize={36}
            lineHeight={36}
            flexShrink={1}
            color={wholeColor}
          >
            {whole}
          </Text>
          {decimal ? (
            <Text sensitive fontSize={17} lineHeight={17} alignSelf="flex-start" color={color}>
              {decimal}
            </Text>
          ) : undefined}
        </>
      ) : (
        children
      )}
    </XStack>
  );
}

const palette = {
  neutral: { color: "$uiNeutralSecondary", wholeColor: undefined },
  danger: { color: "$uiErrorTertiary", wholeColor: "$uiErrorSecondary" },
  success: { color: "$uiSuccessTertiary", wholeColor: "$uiSuccessSecondary" },
};
