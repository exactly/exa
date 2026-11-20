import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform } from "react-native";

import { selectionAsync } from "expo-haptics";
import { useNavigation } from "expo-router";
import Head from "expo-router/head";
import { TabSlot, TabTrigger, useTabsWithTriggers } from "expo-router/ui";

import { getTokens, XStack, YStack } from "tamagui";

import TabBarContext from "../../../components/context/TabBarContext";
import StatusIndicator from "../../../components/shared/StatusIndicator";
import Text from "../../../components/shared/Text";
import View from "../../../components/shared/View";
import { CalendarCheck } from "../../../generated/icons/CalendarCheck";
import { CreditCard } from "../../../generated/icons/CreditCard";
import { History } from "../../../generated/icons/History";
import { Home } from "../../../generated/icons/Home";
import reportError from "../../../utils/reportError";
import { reload } from "../../../utils/update";
import useInsets from "../../../utils/useInsets";
import usePendingOperations from "../../../utils/usePendingOperations";
import { emitTabPress } from "../../../utils/useTabPress";

const tabs = [
  { name: "index", title: "Home", href: "/", Icon: Home },
  { name: "card", title: "Card", href: "/card", Icon: CreditCard },
  { name: "pay-mode", title: "Payments", href: "/pay-mode", Icon: CalendarCheck },
  { name: "activity", title: "Activity", href: "/activity", Icon: History },
] as const;

function TabItem({
  title,
  Icon,
  isFocused,
  showNotification,
}: {
  Icon: typeof Home;
  isFocused: boolean;
  showNotification: boolean;
  title: string;
}) {
  return (
    <YStack alignItems="center" paddingTop="s3_5" paddingBottom="s3">
      <YStack>
        {showNotification && <StatusIndicator type="notification" />}
        <Icon
          size={getTokens().iconSize.lg.val}
          strokeWidth={getTokens().iconStroke.lg.val}
          color={isFocused ? "interactiveOnBaseBrandDefault" : "uiNeutralSecondary"}
        />
      </YStack>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        caption2
        emphasized={isFocused}
        color={isFocused ? "interactiveOnBaseBrandDefault" : "uiNeutralSecondary"}
      >
        {title}
      </Text>
    </YStack>
  );
}

export default function HomeLayout() {
  const { t } = useTranslation();
  const { count } = usePendingOperations();
  const { NavigationContent, state } = useTabsWithTriggers({
    triggers: tabs.map(({ name, href }) => ({ type: "internal", name, href })),
  });
  const insets = useInsets();
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);
  const focused = tabs.findIndex(({ name }) => name === state.routes[state.index]?.name);
  const navigation = useNavigation();
  useEffect(() => {
    let left: number | undefined;
    const subscription = AppState.addEventListener("change", (status) => {
      if (status !== "active") {
        left ??= Date.now();
        return;
      }
      if (left !== undefined && Date.now() - left >= 60_000 && navigation.isFocused()) reload().catch(reportError);
      left = undefined;
    });
    return () => {
      subscription.remove();
    };
  }, [navigation]);
  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Exa App</title>
          <meta name="description" content="Exactly what finance should be today" />
        </Head>
      )}
      <NavigationContent>
        <View flex={1}>
          <TabBarContext value={height}>
            <TabSlot style={{ flex: 1 }} />
          </TabBarContext>
          <YStack
            position="absolute"
            bottom="s0"
            left="s0"
            right="s0"
            pointerEvents="box-none"
            paddingLeft={insets.left}
            paddingRight={insets.right}
            paddingBottom={Math.max(insets.bottom, getTokens().space.s6.val)}
            onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
          >
            <XStack
              marginHorizontal="s4"
              padding="s1"
              borderRadius="r_0"
              borderWidth={1}
              borderColor="borderNeutralMild"
              backgroundColor="backgroundSoft"
            >
              <XStack flex={1} role="tablist" onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
                {focused !== -1 && width > 0 && (
                  <View
                    position="absolute"
                    top="s0"
                    bottom="s0"
                    width={width / tabs.length}
                    x={(focused * width) / tabs.length}
                    transition={{ preset: "quick", spring: { overshootClamping: true } }}
                    padding="s1"
                  >
                    <View flex={1} borderRadius="r_0" backgroundColor="interactiveBaseBrandDefault" />
                  </View>
                )}
                {tabs.map(({ name, title, href, Icon }, index) => (
                  <TabTrigger
                    key={name}
                    name={name}
                    href={href}
                    role="tab"
                    aria-selected={index === focused}
                    hitSlop={{ top: 4, bottom: 4 }}
                    style={{ flex: 1 }}
                    onPress={() => {
                      selectionAsync().catch(reportError);
                      (index === focused ? reload() : Promise.resolve(false))
                        .then((reloaded) => {
                          if (!reloaded) emitTabPress(name);
                        })
                        .catch(reportError);
                    }}
                  >
                    <TabItem
                      title={t(title)}
                      Icon={Icon}
                      isFocused={index === focused}
                      showNotification={name === "activity" && count > 0}
                    />
                  </TabTrigger>
                ))}
              </XStack>
            </XStack>
          </YStack>
        </View>
      </NavigationContent>
    </>
  );
}
