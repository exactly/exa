import React from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Platform } from "react-native";

import { Tabs } from "expo-router";
import Head from "expo-router/head";

import { Boxes, Coins, CreditCard, FileText, Home } from "@tamagui/lucide-icons";

import { activityRefreshControlReference, activityScrollReference } from "../../../components/activity/Activity";
import { cardRefreshControlReference, cardScrollReference } from "../../../components/card/Card";
import { defiRefreshControlReference, defiScrollReference } from "../../../components/defi/DeFi";
import { homeRefreshControlReference, homeScrollReference } from "../../../components/home/Home";
import { payModeRefreshControlReference, payModeScrollReference } from "../../../components/pay-mode/PayMode";
import TabBar from "../../../components/shared/TabBar";

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
                    case "defi":
                      scrollView = defiScrollReference.current;
                      refreshControl = defiRefreshControlReference.current;
                      break;
                    case "activity":
                      scrollView = activityScrollReference.current;
                      refreshControl = activityRefreshControlReference.current;
                      break;
                    default:
                      return;
                  }
                  if (scrollView) {
                    if (scrollView instanceof FlatList) {
                      if (!scrollView.props.data?.length) return;
                      scrollView.scrollToIndex({ index: 0, animated: true });
                    } else {
                      scrollView.scrollTo({ y: 0, animated: true });
                    }
                  }
                  if (Platform.OS !== "web") refreshControl?.props.onRefresh?.();
                },
              }}
            />
          );
        })}
      </Tabs>
    </>
  );
}
