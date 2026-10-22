import React from "react";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import { Pressable } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";

import { Spinner, View, XStack } from "tamagui";

import AnimatedView from "./AnimatedView";
import Text from "./Text";
import { AlertTriangle } from "../../generated/icons/AlertTriangle";
import { ChevronRight } from "../../generated/icons/ChevronRight";
import { Info } from "../../generated/icons/Info";

export default function InfoAlert({
  title,
  actionText,
  loading,
  onPress,
  variant = "info",
  icon,
  exiting = FadeOut,
}: {
  actionText?: string;
  exiting?: null | typeof FadeOut;
  icon?: ComponentType<ComponentPropsWithoutRef<typeof Info>>;
  loading?: boolean;
  onPress?: () => void;
  title: string;
  variant?: keyof typeof variants;
}) {
  const { bg, iconBg, icon: variantIcon, color, text } = variants[variant];
  const Icon = icon ?? variantIcon;
  return (
    <AnimatedView
      entering={FadeIn}
      exiting={exiting ?? undefined}
      flexDirection="row"
      borderRadius="r3"
      backgroundColor={bg}
      overflow="hidden"
    >
      <View padding="s4" backgroundColor={iconBg} justifyContent="center" alignItems="center" alignSelf="stretch">
        <Icon size={32} color={color} />
      </View>
      <View gap="s2" padding="s4" flex={1}>
        <Text subHeadline color={text}>
          {title}
        </Text>
        <Pressable
          disabled={loading}
          onPress={() => {
            onPress?.();
          }}
        >
          {actionText && (
            <XStack gap="s1" alignItems="center">
              <Text emphasized subHeadline color={text}>
                {actionText}
              </Text>
              {loading ? <Spinner color={text} /> : <ChevronRight size={16} color={text} strokeWidth={3} />}
            </XStack>
          )}
        </Pressable>
      </View>
    </AnimatedView>
  );
}

const variants = {
  error: {
    bg: "interactiveBaseErrorSoftDefault",
    iconBg: "interactiveBaseErrorDefault",
    icon: AlertTriangle,
    color: "interactiveOnBaseErrorDefault",
    text: "interactiveOnBaseErrorSoft",
  },
  info: {
    bg: "interactiveBaseInformationSoftDefault",
    iconBg: "interactiveBaseInformationDefault",
    icon: Info,
    color: "interactiveOnBaseInformationDefault",
    text: "interactiveOnBaseInformationSoft",
  },
  warning: {
    bg: "interactiveBaseWarningSoftDefault",
    iconBg: "interactiveBaseWarningDefault",
    icon: AlertTriangle,
    color: "interactiveOnBaseWarningDefault",
    text: "interactiveOnBaseWarningSoft",
  },
} as const;
