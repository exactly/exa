import type React from "react";
import { use, useMemo, type ComponentPropsWithoutRef } from "react";

import type { ArrowRight } from "@tamagui/lucide-icons";
import { createStyledContext, Spinner, styled, withStaticProperties, XStack } from "tamagui";

import Text from "./Text";

const ButtonContext = createStyledContext<{
  danger?: boolean;
  dangerSecondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  outlined?: boolean;
  primary?: boolean;
  secondary?: boolean;
  transparent?: boolean;
}>({
  primary: false,
  secondary: false,
  disabled: false,
  danger: false,
  dangerSecondary: false,
  outlined: false,
  transparent: false,
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
    transparent: {
      true: {
        backgroundColor: "transparent",
        borderColor: "transparent",
        color: "$interactiveBaseBrandDefault",
        hoverStyle: { backgroundColor: "$interactiveBaseBrandSoftDefault", color: "$interactiveOnBaseBrandDefault" },
        pressStyle: { backgroundColor: "$interactiveBaseBrandSoftHover", color: "$interactiveOnBaseBrandDefault" },
        disabledStyle: {
          backgroundColor: "transparent",
          borderColor: "transparent",
          color: "$interactiveOnDisabled",
        },
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

const ButtonText = (properties: ComponentPropsWithoutRef<typeof Text>) => {
  const { primary, secondary, disabled, danger, dangerSecondary, outlined, transparent } = use(ButtonContext.context);
  const color = useMemo(() => {
    if (disabled) return "$interactiveOnDisabled";
    if (primary) return "$interactiveOnBaseBrandDefault";
    if (secondary) return "$interactiveOnBaseBrandSoft";
    if (danger) return "$interactiveOnBaseErrorDefault";
    if (dangerSecondary) return "$interactiveOnBaseErrorSoft";
    if (outlined) return "$interactiveBaseBrandDefault";
    if (transparent) return "$interactiveBaseBrandDefault";
  }, [disabled, primary, secondary, danger, dangerSecondary, outlined, transparent]);
  return (
    <Text
      userSelect="none"
      numberOfLines={1}
      emphasized
      subHeadline
      adjustsFontSizeToFit
      flex={1}
      color={color}
      {...properties}
    />
  );
};

const ButtonIcon = (properties: { children: React.ReactElement<ComponentPropsWithoutRef<typeof ArrowRight>> }) => {
  const { children } = properties;
  const { size = "$iconSize.md", strokeWidth = "$iconStroke.md", ...iconProperties } = children.props;
  const IconComponent = children.type as React.ComponentType<ComponentPropsWithoutRef<typeof ArrowRight>>;
  const { primary, secondary, disabled, danger, dangerSecondary, outlined, transparent, loading } = use(
    ButtonContext.context,
  );
  const color = useMemo(() => {
    if (disabled) return "$interactiveOnDisabled";
    if (primary) return "$interactiveOnBaseBrandDefault";
    if (secondary) return "$interactiveOnBaseBrandSoft";
    if (danger) return "$interactiveOnBaseErrorDefault";
    if (dangerSecondary) return "$interactiveOnBaseErrorSoft";
    if (outlined) return "$interactiveBaseBrandDefault";
    if (transparent) return "$interactiveBaseBrandDefault";
  }, [primary, secondary, disabled, danger, dangerSecondary, outlined, transparent]);
  if (loading) return <Spinner width={size} height={size} color={color} />;
  return <IconComponent {...iconProperties} size={size} strokeWidth={strokeWidth} color={color} />;
};

export default withStaticProperties(ButtonFrame, { Props: ButtonContext.Provider, Text: ButtonText, Icon: ButtonIcon });
