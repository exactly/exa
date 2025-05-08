import { Stack } from "expo-router";
import Head from "expo-router/head";
import React from "react";

import useBackgroundColor from "../../utils/useBackgroundColor";

export default function OnboardingLayout() {
  useBackgroundColor();
  return (
    <>
      <Head>
        <title>Exa App</title>
        <meta name="description" content="Onchain banking, today" />
      </Head>
      <Stack initialRouteName="index" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(passkeys)/passkeys" />
        <Stack.Screen name="(passkeys)/about" options={{ presentation: "modal" }} />
      </Stack>
    </>
  );
}
