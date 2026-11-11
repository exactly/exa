import React, { useLayoutEffect, useState, type ReactNode } from "react";
import { Platform, useColorScheme } from "react-native";

import { StatusBar } from "expo-status-bar";

import { TamaguiProvider } from "tamagui";

import { isBase } from "@exactly/common/generated/chain";
import tenants from "@exactly/common/tenants";

import tamagui from "../../../tamagui.config";
import NotificationToast from "../shared/Toast";

export const isBaseTheme =
  isBase &&
  (Platform.OS !== "web" || (typeof window !== "undefined" && !Object.hasOwn(tenants, window.location.origin)));

export default function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useColorScheme();
  const [base, setBase] = useState(Platform.OS !== "web" && isBaseTheme);
  useLayoutEffect(() => {
    setBase(isBaseTheme); // eslint-disable-line @eslint-react/set-state-in-effect
  }, []);
  const dark = !base && theme === "dark";
  return (
    <TamaguiProvider config={tamagui} defaultTheme={dark ? "dark" : base ? "light_base" : "light"}>
      {children}
      <NotificationToast />
      <StatusBar style={dark ? "light" : "dark"} />
    </TamaguiProvider>
  );
}
