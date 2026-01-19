import React from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { Tabs } from "expo-router";
import Head from "expo-router/head";

import { Boxes, Coins, CreditCard, FileText, Home } from "@tamagui/lucide-icons";

import TabBar from "../../../components/shared/TabBar";
import { emitTabPress } from "../../../utils/useTabPress";

const tabs = [
  { name: "index", title: "Home", Icon: Home },
  { name: "card", title: "Card", Icon: CreditCard },
  { name: "pay-mode", title: "Pay Mode", Icon: Coins },
  { name: "defi", title: "DeFi", Icon: Boxes },
  { name: "activity", title: "Activity", Icon: FileText },
] as const;

export default function HomeLayout() {
  const { t } = useTranslation();
  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Exa App</title>
          <meta name="description" content="Exactly what finance should be today" />
        </Head>
      )}
      <Tabs screenOptions={{ headerShown: false }} tabBar={(properties) => <TabBar {...properties} />}>
        {tabs.map(({ name, title, Icon }) => {
          return (
            <Tabs.Screen
              key={name}
              name={name}
              options={{ title: t(title), tabBarIcon: ({ color }) => <Icon size={24} color={color} /> }}
              listeners={{ tabPress: () => emitTabPress(name) }}
            />
          );
        })}
      </Tabs>
    </>
  );
}
