import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import type { ParamListBase } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { SplashScreen, Stack } from "expo-router";
import React, { useEffect } from "react";
import { Spinner } from "tamagui";

import View from "../../components/shared/View";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useBackgroundColor from "../../utils/useBackgroundColor";
import type { RootNavigationProperties } from "../_layout";

export default function AppLayout() {
  useBackgroundColor();
  const rootNavigator = useNavigation<RootNavigationProperties>();
  const { error: noCredential, isLoading, isFetched } = useQuery<Credential>({ queryKey: ["credential"] }, queryClient);

  useEffect(() => {
    if (isLoading || !isFetched) return;
    if (noCredential) rootNavigator.replace("onboarding");
    sdk.actions.ready().catch(reportError);
    SplashScreen.hideAsync().catch(reportError);
  }, [isFetched, isLoading, rootNavigator, noCredential]);

  if (isLoading || !isFetched) return <Loading />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

function Loading() {
  return (
    <View fullScreen padded justifyContent="center" alignItems="center">
      <Spinner width={48} height={48} color="$uiBrandSecondary" />
    </View>
  );
}

export type AppNavigationProperties = NativeStackNavigationProp<AppLayoutParameterList>;
export interface AppLayoutParameterList extends ParamListBase {
  "(home)": undefined;
  "getting-started": undefined;
  "pending-proposals": undefined;
  "activity-details": undefined;
  "roll-debt": undefined;
  "add-funds": { screen: "add-crypto" | "add-fiat" | "add-crypto-about" | "index" };
  "send-funds": {
    screen: "index" | "qr" | "asset" | "amount" | "withdraw" | "processing";
    params?: { receiver?: string };
  };
  loan: { screen: "index" | "amount" | "installments" | "maturity" | "receiver" | "review" };
  swaps: undefined;
}
