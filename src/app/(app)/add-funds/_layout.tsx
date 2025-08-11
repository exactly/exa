import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function AddFundsLayout() {
  useBackgroundColor();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add-crypto" />
    </Stack>
  );
}

export type AddFundsNavigationProperties = NativeStackNavigationProp<AddFundsParameterList>;
export interface AddFundsParameterList extends ParamListBase {
  index: undefined;
  "add-crypto": undefined;
}
