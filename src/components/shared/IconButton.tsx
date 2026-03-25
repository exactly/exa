import type { ComponentPropsWithoutRef, ComponentType } from "react";
import React from "react";

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
    <Frame role="button" aria-disabled={properties.disabled} {...properties}>
      <Icon size={size} color={color} />
    </Frame>
  );
}

const Frame = styled(Stack, {
  alignItems: "center",
  justifyContent: "center",
  minWidth: 48,
  minHeight: 48,
  margin: -12,
  cursor: "pointer",
  pressStyle: { opacity: 0.7 },
  variants: { disabled: { true: { opacity: 0.5, cursor: "default" } } } as const,
});
