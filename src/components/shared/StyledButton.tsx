import type React from "react";
import { use, useMemo, type ComponentPropsWithoutRef } from "react";

import type { ArrowRight } from "@tamagui/lucide-icons";
import { createStyledContext, Spinner, styled, withStaticProperties, XStack, YStack } from "tamagui";

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

const pressable = (hover: object, press: object) => ({
  hoverStyle: hover,
  pressStyle: press,
  "$group-column-hover": hover,
  "$group-column-press": press,
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
        ...pressable(
          { backgroundColor: "$interactiveBaseBrandHover" },
          { backgroundColor: "$interactiveBaseBrandPressed" },
        ),
      },
    },
    secondary: {
      true: {
        backgroundColor: "$interactiveBaseBrandSoftDefault",
        ...pressable(
          { backgroundColor: "$interactiveBaseBrandSoftHover" },
          { backgroundColor: "$interactiveBaseBrandSoftPressed" },
        ),
      },
    },
    danger: {
      true: {
        backgroundColor: "$interactiveBaseErrorDefault",
        ...pressable(
          { backgroundColor: "$interactiveBaseErrorHover" },
          { backgroundColor: "$interactiveBaseErrorPressed" },
        ),
      },
    },
    dangerSecondary: {
      true: {
        backgroundColor: "$interactiveBaseErrorSoftDefault",
        ...pressable(
          { backgroundColor: "$interactiveBaseErrorSoftHover" },
          { backgroundColor: "$interactiveBaseErrorSoftPressed" },
        ),
      },
    },
    outlined: {
      true: {
        backgroundColor: "transparent",
        borderColor: "$interactiveBaseBrandDefault",
        borderWidth: 1,
        color: "$interactiveBaseBrandDefault",
        ...pressable(
          { backgroundColor: "$interactiveBaseBrandSoftDefault", color: "$interactiveOnBaseBrandDefault" },
          { backgroundColor: "$interactiveBaseBrandSoftHover", color: "$interactiveOnBaseBrandDefault" },
        ),
      },
    },
    transparent: {
      true: {
        backgroundColor: "transparent",
        borderColor: "transparent",
        color: "$interactiveBaseBrandDefault",
        ...pressable(
          { backgroundColor: "$interactiveBaseBrandSoftDefault", color: "$interactiveOnBaseBrandDefault" },
          { backgroundColor: "$interactiveBaseBrandSoftHover", color: "$interactiveOnBaseBrandDefault" },
        ),
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
        ...pressable({ backgroundColor: "$interactiveDisabled" }, { backgroundColor: "$interactiveDisabled" }),
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

const ButtonColumnFrame = styled(YStack, {
  name: "ButtonColumn",
  context: ButtonContext,
  alignItems: "center",
  gap: "$s3_5",
  cursor: "pointer",
  group: "column",
  pointerEvents: "box-only",
  variants: {
    primary: { true: {} },
    secondary: { true: {} },
    danger: { true: {} },
    dangerSecondary: { true: {} },
    outlined: { true: {} },
    transparent: { true: {} },
    loading: { true: {} },
    disabled: { true: { cursor: "not-allowed" } },
  } as const,
});

function ButtonColumn({
  primary,
  secondary,
  danger,
  dangerSecondary,
  outlined,
  transparent,
  loading,
  disabled,
  ...properties
}: ComponentPropsWithoutRef<typeof ButtonColumnFrame>) {
  const context = { primary, secondary, danger, dangerSecondary, outlined, transparent, loading, disabled };
  return (
    <ButtonContext.context value={context}>
      <ButtonColumnFrame {...context} {...properties} />
    </ButtonContext.context>
  );
}

function ButtonLabel(properties: ComponentPropsWithoutRef<typeof Text>) {
  const { disabled } = use(ButtonContext.context);
  return (
    <Text
      footnote
      color={disabled ? "$interactiveOnDisabled" : "$interactiveBaseBrandDefault"}
      textAlign="center"
      {...properties}
    />
  );
}

export default withStaticProperties(ButtonFrame, {
  Props: ButtonContext.Provider,
  Text: ButtonText,
  Icon: ButtonIcon,
  Column: ButtonColumn,
  Label: ButtonLabel,
});
