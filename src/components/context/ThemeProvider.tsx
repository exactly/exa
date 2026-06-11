import React, { type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { StatusBar } from "expo-status-bar";

import { TamaguiProvider } from "tamagui";

import tamagui, { isBase } from "../../../tamagui.config";
import NotificationToast from "../shared/Toast";
import SafeToastViewport from "../shared/ToastViewport";

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useColorScheme();
  const dark = !isBase && theme === "dark";
  return (
    <TamaguiProvider config={tamagui} defaultTheme={dark ? "dark" : "light"}>
      {children}
      <NotificationToast />
      <SafeToastViewport />
      <StatusBar style={dark ? "light" : "dark"} />
    </TamaguiProvider>
  );
}
