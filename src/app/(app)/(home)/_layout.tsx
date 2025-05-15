import { CircleDollarSign, CreditCard, FileText, Home } from "@tamagui/lucide-icons";
import { Tabs } from "expo-router";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { useAccount } from "wagmi";

import TabBar from "../../../components/shared/TabBar";
import UpgradeAppDialog from "../../../components/shared/UpgradeAppDialog";
import { enablePrompt } from "../../../utils/onesignal";
import useIntercom from "../../../utils/useIntercom";

const tabs = [
  { name: "index", title: "Home", Icon: Home },
  { name: "card", title: "Card", Icon: CreditCard },
  { name: "payments", title: "Pay", Icon: CircleDollarSign },
  { name: "activity", title: "Activity", Icon: FileText },
] as const;

export default function HomeLayout() {
  const { address } = useAccount();
  useIntercom(address);
  useEffect(() => {
    enablePrompt();
  }, []);
  return (
    <>
      {Platform.OS !== "web" && <UpgradeAppDialog />}
      <Tabs screenOptions={{ headerShown: false }} tabBar={(properties) => <TabBar {...properties} />}>
        {tabs.map(({ name, title, Icon }) => (
          <Tabs.Screen
            key={name}
            name={name}
            options={{ title, tabBarIcon: ({ color }) => <Icon size={24} color={color} /> }}
          />
        ))}
      </Tabs>
    </>
  );
}
