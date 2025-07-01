import type { ArrowRight } from "@tamagui/lucide-icons";
import type React from "react";
import { cloneElement, isValidElement, useContext, useMemo, type ComponentPropsWithoutRef } from "react";
import { createStyledContext, Spinner, styled, withStaticProperties, XStack } from "tamagui";

import Text from "./Text";

const ButtonContext = createStyledContext<{
  primary?: boolean;
  secondary?: boolean;
  disabled?: boolean;
  danger?: boolean;
  dangerSecondary?: boolean;
  outlined?: boolean;
  loading?: boolean;
}>({
  primary: false,
  secondary: false,
  disabled: false,
  danger: false,
  dangerSecondary: false,
  outlined: false,
  loading: false,
});

const ButtonFrame = styled(XStack, {
  name: "Button",
  context: ButtonContext,
  cursor: "pointer",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  borderRadius: "$r3",
  borderWidth: 0,
  userSelect: "none",
  gap: "$s3",
  paddingHorizontal: "$s4",
  minHeight: 64,
  variants: {
    primary: {
      true: {
        backgroundColor: "$interactiveBaseBrandDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseBrandHover" },
        pressStyle: { backgroundColor: "$interactiveBaseBrandPressed" },
      },
    },
    secondary: {
      true: {
        backgroundColor: "$interactiveBaseBrandSoftDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseBrandSoftHover" },
        pressStyle: { backgroundColor: "$interactiveBaseBrandSoftPressed" },
      },
    },
    danger: {
      true: {
        backgroundColor: "$interactiveBaseErrorDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseErrorHover" },
        pressStyle: { backgroundColor: "$interactiveBaseErrorPressed" },
      },
    },
    dangerSecondary: {
      true: {
        backgroundColor: "$interactiveBaseErrorSoftDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseErrorSoftHover" },
        pressStyle: { backgroundColor: "$interactiveBaseErrorSoftPressed" },
      },
    },
    outlined: {
      true: {
        backgroundColor: "transparent",
        borderColor: "$interactiveBaseBrandDefault",
        borderWidth: 1,
        color: "$interactiveBaseBrandDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseBrandSoftDefault", color: "$interactiveOnBaseBrandDefault" },
        pressStyle: { backgroundColor: "$interactiveBaseBrandSoftHover", color: "$interactiveOnBaseBrandDefault" },
      },
    },
    loading: { true: {} }, // HACK satisfy prop type
    disabled: {
      true: {
        backgroundColor: "$interactiveDisabled",
        borderColor: "transparent",
        cursor: "not-allowed",
        hoverStyle: { backgroundColor: "$interactiveDisabled" },
        pressStyle: { backgroundColor: "$interactiveDisabled" },
      },
    },
  } as const,
});

export const ButtonText = styled(Text, {
  name: "ButtonText",
  context: ButtonContext,
  userSelect: "none",
  numberOfLines: 1,
  emphasized: true,
  subHeadline: true,
  adjustsFontSizeToFit: true,
  flex: 1,
  variants: {
    primary: { true: { color: "$interactiveOnBaseBrandDefault" } },
    secondary: { true: { color: "$interactiveOnBaseBrandSoft" } },
    danger: { true: { color: "$interactiveOnBaseErrorDefault" } },
    dangerSecondary: { true: { color: "$interactiveOnBaseErrorSoft" } },
    outlined: { true: { color: "$interactiveBaseBrandDefault" } },
    disabled: { true: { color: "$interactiveOnDisabled" } },
  } as const,
});

const ButtonIcon = (properties: { children: React.ReactElement<ComponentPropsWithoutRef<typeof ArrowRight>> }) => {
  const element = properties.children;
  const size = element.props.size ?? "$iconSize.md";
  const strokeWidth = element.props.strokeWidth ?? "$iconStroke.md";
  const { primary, secondary, disabled, danger, dangerSecondary, outlined, loading } = useContext(
    ButtonContext.context,
  );
  const color = useMemo(() => {
    if (disabled) return "$interactiveOnDisabled";
    if (primary) return "$interactiveOnBaseBrandDefault";
    if (secondary) return "$interactiveOnBaseBrandSoft";
    if (danger) return "$interactiveOnBaseErrorDefault";
    if (dangerSecondary) return "$interactiveOnBaseErrorSoft";
    if (outlined) return "$interactiveBaseBrandDefault";
  }, [primary, secondary, disabled, danger, dangerSecondary, outlined]);
  if (loading) return <Spinner width={size} height={size} color={color} />;
  return isValidElement(element) ? cloneElement(element, { size, strokeWidth, color }) : null;
};

export default withStaticProperties(ButtonFrame, { Props: ButtonContext.Provider, Text: ButtonText, Icon: ButtonIcon });
