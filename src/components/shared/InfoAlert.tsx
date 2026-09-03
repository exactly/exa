import React from "react";
import type { ComponentPropsWithoutRef, ComponentType } from "react";
import { Pressable } from "react-native";

import { AlertTriangle, ChevronRight, Info } from "@tamagui/lucide-icons";
import { Spinner, View, XStack } from "tamagui";

import Text from "./Text";

export default function InfoAlert({
  title,
  actionText,
  loading,
  onPress,
  variant = "info",
  icon,
}: {
  actionText?: string;
  icon?: ComponentType<ComponentPropsWithoutRef<typeof Info>>;
  loading?: boolean;
  onPress?: () => void;
  title: string;
  variant?: keyof typeof variants;
}) {
  const { bg, iconBg, icon: variantIcon, color, text } = variants[variant];
  const Icon = icon ?? variantIcon;
  return (
    <XStack borderRadius="$r3" backgroundColor={bg} overflow="hidden">
      <View padding="$s4" backgroundColor={iconBg} justifyContent="center" alignItems="center" alignSelf="stretch">
        <Icon size={32} color={color} />
      </View>
      <View gap="$s2" padding="$s4" flex={1}>
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
            <XStack gap="$s1" alignItems="center">
              <Text emphasized subHeadline color={text}>
                {actionText}
              </Text>
              {loading ? <Spinner color={text} /> : <ChevronRight size={16} color={text} strokeWidth={3} />}
            </XStack>
          )}
        </Pressable>
      </View>
    </XStack>
  );
}

const variants = {
  error: {
    bg: "$interactiveBaseErrorSoftDefault",
    iconBg: "$interactiveBaseErrorDefault",
    icon: AlertTriangle,
    color: "$interactiveOnBaseErrorDefault",
    text: "$interactiveOnBaseErrorSoft",
  },
  info: {
    bg: "$interactiveBaseInformationSoftDefault",
    iconBg: "$interactiveBaseInformationDefault",
    icon: Info,
    color: "$interactiveOnBaseInformationDefault",
    text: "$interactiveOnBaseInformationSoft",
  },
  warning: {
    bg: "$interactiveBaseWarningSoftDefault",
    iconBg: "$interactiveBaseWarningDefault",
    icon: AlertTriangle,
    color: "$interactiveOnBaseWarningDefault",
    text: "$interactiveOnBaseWarningSoft",
  },
} as const;
