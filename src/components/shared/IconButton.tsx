import type { ComponentPropsWithoutRef, ComponentType } from "react";
import React from "react";
import { Platform } from "react-native";

import type { ArrowRight } from "@tamagui/lucide-icons";
import { Stack, styled } from "tamagui";

export default function IconButton({
  icon: Icon,
  color = "$uiNeutralPrimary",
  size = 24,
  ...properties
}: ComponentPropsWithoutRef<typeof Frame> & {
  color?: string;
  icon: ComponentType<ComponentPropsWithoutRef<typeof ArrowRight>>;
  size?: number;
}) {
  return (
    <Frame
      role="button"
      aria-disabled={properties.disabled}
      hitSlop={Platform.OS === "web" ? undefined : 12}
      {...(Platform.OS === "web" ? { type: "button" as const } : {})}
      {...properties}
      className={
        Platform.OS === "web" ? [properties.className, "icon-slop"].filter(Boolean).join(" ") : properties.className
      }
    >
      <Icon size={size} color={color} />
    </Frame>
  );
}

const Frame = styled(Stack, {
  tag: "button",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 24,
  minHeight: 24,
  padding: 0,
  backgroundColor: "transparent",
  borderWidth: 0,
  borderColor: "transparent",
  cursor: "pointer",
  userSelect: "none",
  borderRadius: "$r2",
  focusVisibleStyle: { outlineStyle: "solid", outlineWidth: 2, outlineColor: "$borderBrandStrong", outlineOffset: 2 },
  pressStyle: { opacity: 0.7 },
  variants: { disabled: { true: { opacity: 0.5, cursor: "default" } } } as const,
});
