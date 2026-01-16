import React, { type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { StatusBar } from "expo-status-bar";

import { TamaguiProvider } from "tamagui";

import tamagui from "../../../tamagui.config";
import NotificationToast from "../shared/Toast";
import SafeToastViewport from "../shared/ToastViewport";

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useColorScheme();
  return (
    <TamaguiProvider config={tamagui} defaultTheme={theme ?? "light"}>
      {children}
      <NotificationToast />
      <SafeToastViewport />
      <StatusBar style="auto" />
    </TamaguiProvider>
  );
}
