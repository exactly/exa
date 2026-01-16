import React, { useMemo } from "react";

import { LinearGradient } from "expo-linear-gradient";

import { ScrollView, styled, useTheme } from "tamagui";

import SafeView from "./SafeView";

export default function GradientScrollView({
  children,
  variant = "neutral",
  stickyHeader = false,
}: {
  children: React.ReactNode;
  stickyHeader?: boolean;
  variant?: "error" | "info" | "neutral" | "success";
}) {
  const theme = useTheme();
  const config = VARIANTS[variant];
  const gradientColors = useMemo((): [string, string] => {
    const [mainColor, secondaryColor] = config.gradientColors;
    const main = theme[mainColor as keyof typeof theme];
    const secondary = theme[secondaryColor as keyof typeof theme];
    if (!main || !secondary) return [theme.backgroundStrong.val, theme.backgroundSoft.val];
    return [String(main.val), String(secondary.val)];
  }, [theme, config.gradientColors]);
  return (
    <SafeView fullScreen backgroundColor={config.backgroundColor}>
      <StyledGradient
        locations={[0.5, 1]}
        position="absolute"
        top={0}
        left={0}
        right={0}
        height={220}
        opacity={config.gradientOpacity}
        colors={gradientColors}
      />
      <ScrollView
        padding="$s4"
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={stickyHeader ? [0] : undefined}
        stickyHeaderHiddenOnScroll={stickyHeader}
        contentContainerStyle={{
          flexGrow: 1,
          flexDirection: "column",
          justifyContent: "space-between",
          gap: "$s4_5",
        }}
      >
        {children}
      </ScrollView>
    </SafeView>
  );
}

const StyledGradient = styled(LinearGradient, {});

const VARIANTS = {
  error: {
    backgroundColor: "$backgroundSoft",
    textColor: "$uiErrorPrimary",
    gradientColors: ["uiErrorSecondary", "backgroundSoft"] as const,
    gradientOpacity: 0.2,
  },
  success: {
    backgroundColor: "$backgroundSoft",
    textColor: "$uiSuccessPrimary",
    gradientColors: ["uiSuccessSecondary", "backgroundSoft"] as const,
    gradientOpacity: 0.2,
  },
  info: {
    backgroundColor: "$backgroundSoft",
    textColor: "$uiInfoPrimary",
    gradientColors: ["uiInfoSecondary", "backgroundSoft"] as const,
    gradientOpacity: 0.2,
  },
  neutral: {
    backgroundColor: "$backgroundSoft",
    textColor: "$uiNeutralPrimary",
    gradientColors: ["backgroundStrong", "backgroundSoft"] as const,
    gradientOpacity: 0.8,
  },
} as const;
