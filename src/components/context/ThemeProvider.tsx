import React, { type ReactNode } from "react";
import { useColorScheme } from "react-native";

import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";

import { TamaguiProvider, useTheme } from "tamagui";

import { isBase } from "@exactly/common/generated/chain";

import tamagui from "../../../tamagui.config";
import NotificationToast from "../shared/Toast";
import SafeToastViewport from "../shared/ToastViewport";

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useColorScheme();
  const dark = !isBase && theme === "dark";
  return (
    <TamaguiProvider config={tamagui} defaultTheme={dark ? "dark" : "light"}>
      <NavigationTheme dark={dark}>{children}</NavigationTheme>
      <NotificationToast />
      <SafeToastViewport />
      <StatusBar style={dark ? "light" : "dark"} />
    </TamaguiProvider>
  );
}

function NavigationTheme({ dark, children }: { children: ReactNode; dark: boolean }) {
  const { backgroundSoft } = useTheme();
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationThemeProvider value={{ ...base, colors: { ...base.colors, background: backgroundSoft.val } }}>
      {children}
    </NavigationThemeProvider>
  );
}
