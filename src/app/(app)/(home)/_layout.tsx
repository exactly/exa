import { CreditCard, Ellipsis, HandCoins, Home } from "@tamagui/lucide-icons";
import { Tabs } from "expo-router";
import Head from "expo-router/head";
import React, { useEffect } from "react";
import { FlatList, Platform } from "react-native";
import { useAccount } from "wagmi";

import { cardRefreshControlReference, cardScrollReference } from "../../../components/card/Card";
import { homeRefreshControlReference, homeScrollReference } from "../../../components/home/Home";
import { loansRefreshControlReference, loansScrollReference } from "../../../components/loans/Loans";
import TabBar from "../../../components/shared/TabBar";
import { enablePrompt } from "../../../utils/onesignal";
import useIntercom from "../../../utils/useIntercom";

const tabs = [
  { name: "index", title: "Home", Icon: Home },
  { name: "card", title: "Card", Icon: CreditCard },
  { name: "loans", title: "Loans", Icon: HandCoins },
  { name: "more", title: "More", Icon: Ellipsis },
] as const;

export default function HomeLayout() {
  const { address } = useAccount();
  useIntercom(address);
  useEffect(() => {
    enablePrompt();
  }, []);
  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Exa App</title>
          <meta name="description" content="Onchain banking, today" />
        </Head>
      )}
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
                  case "loans":
                    scrollView = loansScrollReference.current;
                    refreshControl = loansRefreshControlReference.current;
                    break;
                  case "more":
                    console.log("more pressed"); // TODO open/close drawer menu
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
    </>
  );
}
