import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function AddFundsLayout() {
  useBackgroundColor();
  return (
    <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="qr" options={{ presentation: "modal" }} />
      <Stack.Screen name="asset" />
      <Stack.Screen name="amount" />
      <Stack.Screen name="withdraw" options={{ presentation: "modal" }} />
    </Stack>
  );
}
