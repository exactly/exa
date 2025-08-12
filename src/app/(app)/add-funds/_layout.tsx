import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function AddFundsLayout() {
  useBackgroundColor();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add-crypto" />
      <Stack.Screen name="add-crypto-about" options={{ presentation: "formSheet", contentStyle: { height: "100%" } }} />
      <Stack.Screen name="add-fiat" />
    </Stack>
  );
}
