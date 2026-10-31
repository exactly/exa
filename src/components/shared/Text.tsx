import React, { type ComponentPropsWithoutRef } from "react";
import { Platform, type FontVariant } from "react-native";

import { styled, Text as TamaguiText } from "tamagui";

import { useQuery } from "@tanstack/react-query";

const StyledText = styled(TamaguiText, {
  fontFamily: "body",
  fontVariant: ["stylistic-one", "stylistic-two", "stylistic-three"],
  ...(Platform.OS === "web" && { lineHeight: "normal", letterSpacing: -0.028 }),
  defaultVariants: { primary: true },
  variants: {
    emphasized: { true: { fontWeight: "bold" } },
    primary: {
      true: {
        color: "uiNeutralPrimary",
      },
    },
    secondary: {
      true: {
        color: "uiNeutralSecondary",
      },
    },
    largeTitle: { true: { fontSize: 36, lineHeight: "47px", letterSpacing: -0.072 } },
    title: { true: { fontSize: 30, lineHeight: "39px", letterSpacing: -0.06 } },
    title2: { true: { fontSize: 23, lineHeight: "30px", letterSpacing: -0.046 } },
    title3: { true: { fontSize: 21, lineHeight: "27px", letterSpacing: -0.042 } },
    headline: { true: { fontSize: 18, lineHeight: "23px", letterSpacing: -0.036 } },
    body: { true: { fontSize: 18, lineHeight: "23px", letterSpacing: -0.036 } },
    callout: { true: { fontSize: 17, lineHeight: "22px", letterSpacing: -0.034 } },
    subHeadline: { true: { fontSize: 16, lineHeight: "21px", letterSpacing: -0.032 } },
    footnote: { true: { fontSize: 14, lineHeight: "18px", letterSpacing: -0.028 } },
    caption: { true: { fontSize: 13, lineHeight: "17px", letterSpacing: -0.026 } },
    caption2: { true: { fontSize: 12, lineHeight: "16px", letterSpacing: -0.024 } },
    brand: {
      true: {
        color: "interactiveBaseBrandDefault",
      },
    },
    centered: { true: { textAlign: "center" } },
    pill: {
      true: {
        fontWeight: "bold",
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: "r2",
      },
    },
    strikeThrough: { true: { textDecorationLine: "line-through" } },
    mono: {
      true: {
        fontFamily: "mono",
        fontVariant: [] as FontVariant[],
      },
    },
  } as const,
});

type TextProperties = ComponentPropsWithoutRef<typeof StyledText> & {
  ref?: React.Ref<React.ComponentRef<typeof StyledText>>;
  sensitive?: boolean;
};

const TextComponent = ({ sensitive, style, ...rest }: TextProperties) => {
  const composed = Platform.OS === "android" ? [{ includeFontPadding: false }, style] : style;
  return sensitive ? <SensitiveText style={composed} {...rest} /> : <StyledText style={composed} {...rest} />;
};

TextComponent.displayName = "Text";

export default TextComponent;

function SensitiveText({ children, ...rest }: Omit<TextProperties, "sensitive">) {
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  return <StyledText {...rest}>{hidden ? "***" : children}</StyledText>;
}
