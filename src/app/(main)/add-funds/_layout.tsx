import React from "react";

import { Stack } from "expo-router";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function AddFundsLayout() {
  useBackgroundColor();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="add-crypto" />
      <Stack.Screen name="bridge" />
      <Stack.Screen name="kyc" />
      <Stack.Screen name="onboard" />
      <Stack.Screen name="ramp" />
      <Stack.Screen name="status" />
    </Stack>
  );
}
