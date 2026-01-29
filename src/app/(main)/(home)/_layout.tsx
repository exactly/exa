import React from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import Head from "expo-router/head";
import { TabList, Tabs, TabSlot, TabTrigger, useTabTrigger } from "expo-router/ui";

import { Boxes, Coins, CreditCard, FileText, Home } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import SafeView from "../../../components/shared/SafeView";
import StatusIndicator from "../../../components/shared/StatusIndicator";
import Text from "../../../components/shared/Text";
import usePendingOperations from "../../../utils/usePendingOperations";
import { emitTabPress } from "../../../utils/useTabPress";

const tabs = [
  { name: "index", title: "Home", href: "/", Icon: Home },
  { name: "card", title: "Card", href: "/card", Icon: CreditCard },
  { name: "pay-mode", title: "Pay Mode", href: "/pay-mode", Icon: Coins },
  { name: "defi", title: "DeFi", href: "/defi", Icon: Boxes },
  { name: "activity", title: "Activity", href: "/activity", Icon: FileText },
] as const;

function TabItem({
  name,
  title,
  Icon,
  showNotification,
}: {
  Icon: typeof Home;
  name: string;
  showNotification: boolean;
  title: string;
}) {
  const { trigger } = useTabTrigger({ name });
  const isFocused = trigger?.isFocused ?? false;
  return (
    <YStack alignItems="center" paddingVertical="$s3">
      <YStack>
        {showNotification && <StatusIndicator type="notification" />}
        <Icon size={24} color={isFocused ? "$uiBrandSecondary" : "$uiNeutralSecondary"} />
      </YStack>
      <Text primary={false} textAlign="center" color={isFocused ? "$uiBrandSecondary" : "$uiNeutralSecondary"}>
        {title}
      </Text>
    </YStack>
  );
}

export default function HomeLayout() {
  const { t } = useTranslation();
  const { count } = usePendingOperations();
  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Exa App</title>
          <meta name="description" content="Exactly what finance should be today" />
        </Head>
      )}
      <Tabs>
        <TabSlot style={{ flex: 1 }} />
        <TabList asChild>
          <SafeView
            flexDirection="row"
            width="100%"
            paddingTop={0}
            backgroundColor="$backgroundSoft"
            justifyContent="center"
            borderTopWidth={1}
            borderTopColor="$borderNeutralSoft"
          >
            {tabs.map(({ name, title, href, Icon }) => (
              <TabTrigger key={name} name={name} href={href} style={{ flex: 1 }} onPress={() => emitTabPress(name)}>
                <TabItem name={name} title={t(title)} Icon={Icon} showNotification={name === "activity" && count > 0} />
              </TabTrigger>
            ))}
          </SafeView>
        </TabList>
      </Tabs>
    </>
  );
}
