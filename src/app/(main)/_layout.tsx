import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Stack, type UnknownOutputParams } from "expo-router";
import React from "react";

import useBackgroundColor from "../../utils/useBackgroundColor";

export default function AppLayout() {
  useBackgroundColor();
  return <Stack screenOptions={{ headerShown: false }} />;
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
  "add-funds": { screen?: "index" | "add-crypto" | "add-fiat" | "bridge"; params?: { sender?: "external" } };
  "send-funds": {
    screen?: "index" | "qr" | "asset" | "amount";
    params?: UnknownOutputParams & { asset?: string; amount?: string; external?: string; receiver?: string };
  };
  loan: { screen?: "index" | "amount" | "installments" | "maturity" | "receiver" | "review" };
  pay: { screen?: "index"; params?: { maturity?: string | null } };
  swaps: undefined;
  settings: { screen?: "index" | "beta" };
}
