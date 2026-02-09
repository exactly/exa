import React, { type ComponentPropsWithoutRef } from "react";

import { styled, Text as TamaguiText } from "tamagui";

import { useQuery } from "@tanstack/react-query";

const StyledText = styled(TamaguiText, {
  defaultVariants: { primary: true },
  variants: {
    emphasized: { true: { fontWeight: "bold" } },
    primary: { true: { color: "$uiNeutralPrimary" } },
    secondary: { true: { color: "$uiNeutralSecondary" } },
    largeTitle: { true: { fontSize: 36, lineHeight: 47, letterSpacing: -0.072 } },
    title: { true: { fontSize: 30, lineHeight: 39, letterSpacing: -0.06 } },
    title2: { true: { fontSize: 23, lineHeight: 30, letterSpacing: -0.046 } },
    title3: { true: { fontSize: 21, lineHeight: 27, letterSpacing: -0.042 } },
    headline: { true: { fontSize: 18, lineHeight: 23, letterSpacing: -0.036 } },
    body: { true: { fontSize: 18, lineHeight: 23, letterSpacing: -0.036 } },
    callout: { true: { fontSize: 17, lineHeight: 22, letterSpacing: -0.034 } },
    subHeadline: { true: { fontSize: 16, lineHeight: 21, letterSpacing: -0.032 } },
    footnote: { true: { fontSize: 14, lineHeight: 18, letterSpacing: -0.028 } },
    caption: { true: { fontSize: 13, lineHeight: 17, letterSpacing: -0.026 } },
    caption2: { true: { fontSize: 12, lineHeight: 16, letterSpacing: -0.024 } },
    brand: { true: { color: "$interactiveBaseBrandDefault" } },
    centered: { true: { textAlign: "center" } },
    pill: { true: { fontWeight: "bold", paddingHorizontal: 4, paddingVertical: 2, borderRadius: "$r2" } },
    strikeThrough: { true: { textDecorationLine: "line-through" } },
  } as const,
});

type TextProperties = ComponentPropsWithoutRef<typeof StyledText> & {
  ref?: React.Ref<React.ComponentRef<typeof StyledText>>;
  sensitive?: boolean;
};

const TextComponent = ({ ref: reference, children, sensitive, ...rest }: TextProperties) => {
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  return (
    <StyledText ref={reference} {...rest}>
      {sensitive && hidden ? "***" : children}
    </StyledText>
  );
};

TextComponent.displayName = "Text";

export default TextComponent;
