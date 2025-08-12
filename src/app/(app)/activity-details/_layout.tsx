import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function ActivityDetailsLayout() {
  useBackgroundColor();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ presentation: "formSheet" }} />
    </Stack>
  );
}
