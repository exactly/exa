import React, { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo } from "react-native";
import { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { XStack } from "tamagui";

import { onlineManager } from "@tanstack/react-query";

import AnimatedView from "./AnimatedView";
import Text from "./Text";
import View from "./View";
import { WifiOff } from "../../generated/icons/WifiOff";
import useInsets from "../../utils/useInsets";

export default function OfflineBanner({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { top } = useInsets();
  const online = useSyncExternalStore(
    subscribe,
    () => onlineManager.isOnline(),
    () => true,
  );
  useEffect(() => {
    if (!online) AccessibilityInfo.announceForAccessibility(t("No internet connection"));
  }, [online, t]);
  const message = (
    <>
      <WifiOff size={16} color="uiWarningSecondary" />
      <Text footnote emphasized color="uiWarningPrimary">
        {t("No internet connection")}
      </Text>
    </>
  );
  return (
    <View flex={1}>
      {!online && (
        <XStack
          justifyContent="center"
          alignItems="center"
          gap="s2"
          paddingVertical="s3"
          borderBottomWidth={1}
          opacity={0}
          aria-hidden
        >
          {message}
        </XStack>
      )}
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
        >
          <XStack justifyContent="center" alignItems="center" gap="s2" paddingVertical="s3" role="alert">
            {message}
          </XStack>
        </AnimatedView>
      )}
    </View>
  );
}

function subscribe(listener: (online: boolean) => void) {
  return onlineManager.subscribe(listener);
}
