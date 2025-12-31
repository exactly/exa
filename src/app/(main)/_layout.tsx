import { Stack } from "expo-router";
import React, { useEffect } from "react";

import { enablePrompt } from "../../utils/onesignal";
import useBackgroundColor from "../../utils/useBackgroundColor";

export default function AppLayout() {
  useBackgroundColor();
  useEffect(() => {
    enablePrompt();
  }, []);
  return <Stack screenOptions={{ headerShown: false }} />;
}
