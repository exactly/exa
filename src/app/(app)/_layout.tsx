import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import type { ParamListBase } from "@react-navigation/native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { SplashScreen, Stack, type UnknownOutputParams } from "expo-router";
import React, { useEffect } from "react";
import { Spinner } from "tamagui";

import View from "../../components/shared/View";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useBackgroundColor from "../../utils/useBackgroundColor";

export default function AppLayout() {
  useBackgroundColor();
  const navigation = useNavigation<AppNavigationProperties>();
  const { error: noCredential, isLoading, isFetched } = useQuery<Credential>({ queryKey: ["credential"] }, queryClient);

  useEffect(() => {
    if (isLoading || !isFetched) return;
    if (noCredential) navigation.replace("onboarding");
    sdk
      .isInMiniApp()
      .then(async (isInMiniApp) => {
        if (isInMiniApp) await sdk.actions.ready();
      })
      .catch(reportError);
    SplashScreen.hideAsync().catch(reportError);
  }, [isFetched, isLoading, navigation, noCredential]);

  if (isLoading || !isFetched) return <Loading />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

function Loading() {
  useBackgroundColor();
  return (
    <View fullScreen padded justifyContent="center" alignItems="center">
      <Spinner width={48} height={48} color="$uiBrandSecondary" />
    </View>
  );
}

export type AppNavigationProperties = NativeStackNavigationProp<AppLayoutParameterList>;
export interface AppLayoutParameterList extends ParamListBase {
  "(home)": {
    screen?: "index" | "card" | "pay-mode" | "defi" | "activity" | "loans";
    params?: { maturity?: string | null };
  };
  "activity-details": undefined;
  "getting-started": undefined;
  "pending-proposals": undefined;
  portfolio: undefined;
  "roll-debt": { screen?: "index"; params?: { maturity?: string | null } };
  "add-funds": { screen?: "index" | "add-crypto" | "add-fiat" };
  "send-funds": {
    screen?: "index" | "qr" | "asset" | "amount";
    params?: UnknownOutputParams & { receiver?: string };
  };
  loan: { screen?: "index" | "amount" | "installments" | "maturity" | "receiver" | "review" };
  pay: { screen?: "index"; params?: { maturity?: string | null } };
  swaps: undefined;
  settings: { screen?: "index" | "beta" };
}
