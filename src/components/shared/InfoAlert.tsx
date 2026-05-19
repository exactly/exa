import React from "react";
import { Pressable } from "react-native";

import { AlertTriangle, ChevronRight, Info } from "@tamagui/lucide-icons";
import { Spinner, View, XStack } from "tamagui";

import Text from "./Text";

const variants = {
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
  error: {
    bg: "$interactiveBaseErrorSoftDefault",
    iconBg: "$interactiveBaseErrorDefault",
    icon: AlertTriangle,
    color: "$interactiveOnBaseErrorDefault",
    text: "$interactiveOnBaseErrorSoft",
  },
} as const;

export default function InfoAlert({
  title,
  actionText,
  loading,
  onPress,
  variant = "info",
}: {
  actionText?: string;
  loading?: boolean;
  onPress?: () => void;
  title: string;
  variant?: keyof typeof variants;
}) {
  const { bg, iconBg, icon: Icon, color, text } = variants[variant];
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
