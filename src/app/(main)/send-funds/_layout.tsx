import React from "react";

import { Stack } from "expo-router";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function SendFundsLayout() {
  useBackgroundColor();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="receiver" />
      <Stack.Screen name="onboard" />
      <Stack.Screen name="kyc" />
      <Stack.Screen name="status" />
      <Stack.Screen name="recipients" />
      <Stack.Screen name="new-recipient" />
      <Stack.Screen name="send-amount" />
      <Stack.Screen name="review" />
      <Stack.Screen name="qr" />
      <Stack.Screen name="asset" />
      <Stack.Screen name="amount" />
    </Stack>
  );
}
