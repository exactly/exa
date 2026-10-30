import type React from "react";
import { use, useMemo, type ComponentPropsWithoutRef } from "react";

import type { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { createStyledContext, getTokens, Spinner, styled, withStaticProperties, XStack, YStack } from "tamagui";

import Text from "./Text";

type ButtonContextValue = {
  danger?: boolean;
  dangerSecondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  outlined?: boolean;
  primary?: boolean;
  secondary?: boolean;
  transparent?: boolean;
};

const ButtonContext = createStyledContext<ButtonContextValue>({
  primary: false,
  secondary: false,
  disabled: false,
  danger: false,
  dangerSecondary: false,
  outlined: false,
  transparent: false,
  loading: false,
});

const pressable = (base: string, hover: string, press: string) =>
  `${base} hover:${hover} press:${press} group-hover/column:${hover} group-press/column:${press}`;

const ButtonFrame = styled(XStack, {
  name: "Button",
  context: ButtonContext,
  cursor: "pointer",
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  borderRadius: "r3",
  borderWidth: 0,
  userSelect: "none",
  gap: "s3",
  paddingHorizontal: "s4",
  minHeight: 64,
  variants: {
    primary: {
      true: {
        backgroundColor: pressable(
          "interactiveBaseBrandDefault",
          "interactiveBaseBrandHover",
          "interactiveBaseBrandPressed",
        ),
      },
    },
    secondary: {
      true: {
        backgroundColor: pressable(
          "interactiveBaseBrandSoftDefault",
          "interactiveBaseBrandSoftHover",
          "interactiveBaseBrandSoftPressed",
        ),
      },
    },
    danger: {
      true: {
        backgroundColor: pressable(
          "interactiveBaseErrorDefault",
          "interactiveBaseErrorHover",
          "interactiveBaseErrorPressed",
        ),
      },
    },
    dangerSecondary: {
      true: {
        backgroundColor: pressable(
          "interactiveBaseErrorSoftDefault",
          "interactiveBaseErrorSoftHover",
          "interactiveBaseErrorSoftPressed",
        ),
      },
    },
    outlined: {
      true: {
        backgroundColor: pressable("transparent", "interactiveBaseBrandSoftDefault", "interactiveBaseBrandSoftHover"),
        borderColor: "interactiveBaseBrandDefault",
        borderWidth: 1,
        color: pressable(
          "interactiveBaseBrandDefault",
          "interactiveOnBaseBrandDefault",
          "interactiveOnBaseBrandDefault",
        ),
      },
    },
    transparent: {
      true: {
        backgroundColor: `${pressable("transparent", "interactiveBaseBrandSoftDefault", "interactiveBaseBrandSoftHover")} disabled:transparent`,
        borderColor: "transparent disabled:transparent",
        color: `${pressable("interactiveBaseBrandDefault", "interactiveOnBaseBrandDefault", "interactiveOnBaseBrandDefault")} disabled:interactiveOnDisabled`,
      },
    },
    loading: { true: {} }, // HACK satisfy prop type
    disabled: {
      true: {
        backgroundColor: pressable("interactiveDisabled", "interactiveDisabled", "interactiveDisabled"),
        borderColor: "transparent",
        cursor: "not-allowed",
      },
    },
  } as const,
});

const ButtonText = (properties: ComponentPropsWithoutRef<typeof Text>) => {
  const { primary, secondary, disabled, danger, dangerSecondary, outlined, transparent } = use(ButtonContext.context);
  const color = useMemo(() => {
    if (disabled) return "interactiveOnDisabled";
    if (primary) return "interactiveOnBaseBrandDefault";
    if (secondary) return "interactiveOnBaseBrandSoft";
    if (danger) return "interactiveOnBaseErrorDefault";
    if (dangerSecondary) return "interactiveOnBaseErrorSoft";
    if (outlined) return "interactiveBaseBrandDefault";
    if (transparent) return "interactiveBaseBrandDefault";
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
  const { size = getTokens().iconSize.md.val, strokeWidth = 2.5, ...iconProperties } = children.props;
  const IconComponent = children.type as React.ComponentType<ComponentPropsWithoutRef<typeof ArrowRight>>;
  const { primary, secondary, disabled, danger, dangerSecondary, outlined, transparent, loading } = use(
    ButtonContext.context,
  );
  const color = useMemo(() => {
    if (disabled) return "interactiveOnDisabled";
    if (primary) return "interactiveOnBaseBrandDefault";
    if (secondary) return "interactiveOnBaseBrandSoft";
    if (danger) return "interactiveOnBaseErrorDefault";
    if (dangerSecondary) return "interactiveOnBaseErrorSoft";
    if (outlined) return "interactiveBaseBrandDefault";
    if (transparent) return "interactiveBaseBrandDefault";
  }, [primary, secondary, disabled, danger, dangerSecondary, outlined, transparent]);
  if (loading) return <Spinner width={size} height={size} color={color} />;
  return <IconComponent {...iconProperties} size={size} strokeWidth={strokeWidth} color={color} />;
};

const ButtonColumnFrame = styled(YStack, {
  name: "ButtonColumn",
  context: ButtonContext,
  alignItems: "center",
  gap: "s3_5",
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
}: ButtonContextValue & Omit<ComponentPropsWithoutRef<typeof ButtonColumnFrame>, keyof ButtonContextValue>) {
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
      numberOfLines={1}
      color={disabled ? "interactiveOnDisabled" : "interactiveBaseBrandDefault"}
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
