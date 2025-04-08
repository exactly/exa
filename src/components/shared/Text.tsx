import { useQuery } from "@tanstack/react-query";
import React, { type ComponentPropsWithoutRef } from "react";
import { Text as TamaguiText, styled } from "tamagui";

const StyledText = styled(TamaguiText, {
  defaultVariants: { primary: true },
  variants: {
    emphasized: { true: { fontWeight: "bold" } },
    primary: { true: { color: "$uiNeutralPrimary" } },
    secondary: { true: { color: "$uiNeutralSecondary" } },
    title: { true: { fontSize: 28, lineHeight: 34, letterSpacing: -0.2 } },
    title2: { true: { fontSize: 22, lineHeight: 28, letterSpacing: -0.2 } },
    title3: { true: { fontSize: 20, lineHeight: 25, letterSpacing: -0.2 } },
    headline: { true: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2 } },
    body: { true: { fontSize: 17, lineHeight: 23, letterSpacing: -0.2 } },
    callout: { true: { fontSize: 16, lineHeight: 21, letterSpacing: -0.2 } },
    subHeadline: { true: { fontSize: 15, lineHeight: 21, letterSpacing: -0.2 } },
    footnote: { true: { fontSize: 13, lineHeight: 18, letterSpacing: -0.2 } },
    caption: { true: { fontSize: 12, lineHeight: 16, letterSpacing: -0.2 } },
    caption2: { true: { fontSize: 11, lineHeight: 14, letterSpacing: -0.2 } },
    brand: { true: { color: "$interactiveBaseBrandDefault" } },
    centered: { true: { textAlign: "center" } },
    pill: { true: { fontWeight: "bold", paddingHorizontal: 4, paddingVertical: 2, borderRadius: "$r2" } },
    strikeThrough: { true: { textDecorationLine: "line-through" } },
  } as const,
});

export default function Text({
  children,
  sensitive,
  ...rest
}: ComponentPropsWithoutRef<typeof StyledText> & { sensitive?: boolean }) {
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  return <StyledText {...rest}>{sensitive && hidden ? "***" : children}</StyledText>;
}
