import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Stack } from "expo-router";
import Head from "expo-router/head";
import React from "react";
import { Platform } from "react-native";

import useBackgroundColor from "../../utils/useBackgroundColor";

export default function OnboardingLayout() {
  useBackgroundColor();
  return (
    <>
      {Platform.OS === "web" && (
        <Head>
          <title>Exa App</title>
          <meta name="description" content="Exactly what finance should be today" />
        </Head>
      )}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="success" />
        <Stack.Screen name="(passkeys)/passkeys" />
        <Stack.Screen name="(passkeys)/about" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}

export type OnboardingNavigationProperties = NativeStackNavigationProp<OnboardingParameterList>;
export interface OnboardingParameterList extends ParamListBase {
  index: undefined;
  success: undefined;
  "(passkeys)/passkeys": undefined;
  "(passkeys)/about": undefined;
}
