import { Coins, CreditCard, FileText, Home } from "@tamagui/lucide-icons";
import { Tabs } from "expo-router";
import React, { useEffect } from "react";
import { FlatList } from "react-native";
import { useAccount } from "wagmi";

import { activityRefreshControlReference, activityScrollReference } from "../../../components/activity/Activity";
import { cardRefreshControlReference, cardScrollReference } from "../../../components/card/Card";
import { homeRefreshControlReference, homeScrollReference } from "../../../components/home/Home";
import { payModeRefreshControlReference, payModeScrollReference } from "../../../components/pay-mode/PayMode";
import TabBar from "../../../components/shared/TabBar";
import { enablePrompt } from "../../../utils/onesignal";
import useIntercom from "../../../utils/useIntercom";

const tabs = [
  { name: "index", title: "Home", Icon: Home },
  { name: "card", title: "Card", Icon: CreditCard },
  { name: "pay-mode", title: "Pay Mode", Icon: Coins },
  { name: "activity", title: "Activity", Icon: FileText },
] as const;

export default function HomeLayout() {
  const { address } = useAccount();
  useIntercom(address);
  useEffect(() => {
    enablePrompt();
  }, []);
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(properties) => <TabBar {...properties} />}>
      {tabs.map(({ name, title, Icon }) => (
        <Tabs.Screen
          listeners={{
            tabPress: () => {
              let scrollView;
              let refreshControl;
              switch (name) {
                case "index":
                  scrollView = homeScrollReference.current;
                  refreshControl = homeRefreshControlReference.current;
                  break;
                case "card":
                  scrollView = cardScrollReference.current;
                  refreshControl = cardRefreshControlReference.current;
                  break;
                case "pay-mode":
                  scrollView = payModeScrollReference.current;
                  refreshControl = payModeRefreshControlReference.current;
                  break;
                case "activity":
                  scrollView = activityScrollReference.current;
                  refreshControl = activityRefreshControlReference.current;
                  break;
              }
              if (scrollView) {
                if (scrollView instanceof FlatList) {
                  if (!scrollView.props.data?.length) return;
                  scrollView.scrollToIndex({ index: 0, animated: true });
                } else {
                  scrollView.scrollTo({ y: 0, animated: true });
                }
              }
              if (refreshControl) {
                refreshControl.props.onRefresh?.();
              }
            },
          }}
          key={name}
          name={name}
          options={{ title, tabBarIcon: ({ color }) => <Icon size={24} color={color} /> }}
        />
      ))}
    </Tabs>
  );
}
