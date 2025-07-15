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
      <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(passkeys)/passkeys" />
        <Stack.Screen name="(passkeys)/about" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}
