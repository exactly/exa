import React, { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo } from "react-native";
import { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { XStack, YStack } from "tamagui";

import { onlineManager, useQuery } from "@tanstack/react-query";

import AnimatedView from "./AnimatedView";
import Text from "./Text";
import View from "./View";
import { CloudOff } from "../../generated/icons/CloudOff";
import { WifiOff } from "../../generated/icons/WifiOff";
import queryClient from "../../utils/queryClient";
import useInsets from "../../utils/useInsets";

export default function OfflineBanner({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { top } = useInsets();
  const online = useSyncExternalStore(
    subscribe,
    () => onlineManager.isOnline(),
    () => true,
  );
  const { data: internet = false } = useQuery<boolean>({ queryKey: ["banner", "internet"] });
  const text = internet ? t("Can't reach Exa") : t("No internet connection");
  const Icon = internet ? CloudOff : WifiOff;
  const { data: height = 0 } = useQuery<number>({ queryKey: ["banner"] });
  useEffect(() => {
    if (online) queryClient.setQueryData(["banner"], 0);
    else AccessibilityInfo.announceForAccessibility(text);
  }, [online, text]);
  return (
    <View flex={1}>
      {!online && <YStack height={height} />}
      <AnimatedView layout={LinearTransition} flex={1}>
        {children}
      </AnimatedView>
      {!online && (
        <AnimatedView
          entering={FadeIn}
          exiting={FadeOut}
          position="absolute"
          top={0}
          left={0}
          right={0}
          paddingTop={top}
          backgroundColor="interactiveBaseWarningSoftDefault"
          borderBottomWidth={1}
          borderColor="borderWarningSoft"
          onLayout={({ nativeEvent }) => {
            if (nativeEvent.layout.height - top !== height) {
              queryClient.setQueryData(["banner"], nativeEvent.layout.height - top);
            }
          }}
        >
          <XStack justifyContent="center" alignItems="center" gap="s2" paddingVertical="s3" role="alert">
            <Icon size={16} color="uiWarningSecondary" />
            <Text footnote emphasized color="uiWarningPrimary">
              {text}
            </Text>
          </XStack>
        </AnimatedView>
      )}
    </View>
  );
}

function subscribe(listener: (online: boolean) => void) {
  return onlineManager.subscribe(listener);
}
