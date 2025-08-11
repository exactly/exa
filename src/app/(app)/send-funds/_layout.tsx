import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function SendFundsLayout() {
  useBackgroundColor();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="qr" />
      <Stack.Screen name="asset" />
      <Stack.Screen name="amount" />
    </Stack>
  );
}

export type SendFundsNavigationProperties = NativeStackNavigationProp<SendFundsParameterList>;
export interface SendFundsParameterList extends ParamListBase {
  index: undefined;
  qr: undefined;
  asset: undefined;
  amount: undefined;
}
