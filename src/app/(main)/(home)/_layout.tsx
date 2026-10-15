import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { selectionAsync } from "expo-haptics";
import Head from "expo-router/head";
import { TabSlot, TabTrigger, useTabsWithTriggers } from "expo-router/ui";

import { CalendarCheck, CreditCard, History, Home } from "@tamagui/lucide-icons-2";
import { XStack, YStack } from "tamagui";

import TabBarContext from "../../../components/context/TabBarContext";
import SafeView from "../../../components/shared/SafeView";
import StatusIndicator from "../../../components/shared/StatusIndicator";
import Text from "../../../components/shared/Text";
import View from "../../../components/shared/View";
import reportError from "../../../utils/reportError";
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
    <YStack alignItems="center" gap={2} paddingVertical="$s2" paddingHorizontal="$s2">
      <YStack>
        {showNotification && <StatusIndicator type="notification" />}
        <Icon size={18} color={isFocused ? "$uiNeutralPrimary" : "$uiNeutralSecondary"} />
      </YStack>
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}
        fontSize={10}
        lineHeight={12}
        letterSpacing={0}
        emphasized={isFocused}
        color={isFocused ? "$uiNeutralPrimary" : "$uiNeutralSecondary"}
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
  const [height, setHeight] = useState(0);
  const [width, setWidth] = useState(0);
  const focused = tabs.findIndex(({ name }) => name === state.routes[state.index]?.name);
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
            bottom={0}
            left={0}
            right={0}
            pointerEvents="box-none"
            onLayout={({ nativeEvent }) => setHeight(nativeEvent.layout.height)}
          >
            <SafeView paddingTop={0} backgroundColor="transparent" pointerEvents="box-none">
              <XStack
                marginHorizontal="$s4"
                marginBottom={useSafeAreaInsets().bottom > 0 ? 0 : "$s3"}
                padding="$s2"
                borderRadius="$r_0"
                borderWidth={1}
                borderColor="$borderNeutralMild"
                backgroundColor="$backgroundElevated"
                boxShadow="0 4px 16px $black/12"
              >
                <XStack flex={1} role="tablist" onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
                  {focused !== -1 && width > 0 && (
                    <View
                      position="absolute"
                      top={0}
                      bottom={0}
                      width={width / tabs.length}
                      x={(focused * width) / tabs.length}
                      transition="quick"
                      borderRadius="$r_0"
                      backgroundColor="$uiBrandTertiary"
                    />
                  )}
                  {tabs.map(({ name, title, href, Icon }, index) => (
                    <TabTrigger
                      key={name}
                      name={name}
                      href={href}
                      role="tab"
                      aria-label={t(title)}
                      aria-selected={index === focused}
                      hitSlop={{ top: 4, bottom: 4 }}
                      style={{ flex: 1 }}
                      onPress={() => {
                        selectionAsync().catch(reportError);
                        emitTabPress(name);
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
            </SafeView>
          </YStack>
        </View>
      </NavigationContent>
    </>
  );
}
