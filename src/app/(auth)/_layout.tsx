import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";
import { SplashScreen, Stack, useFocusEffect, useRouter } from "expo-router";
import Head from "expo-router/head";
import React, { useCallback, useEffect } from "react";
import { Platform } from "react-native";

import reportError from "../../utils/reportError";
import useBackgroundColor from "../../utils/useBackgroundColor";

export default function OnboardingLayout() {
  useBackgroundColor();
  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const { data: credential, isLoading, isFetched } = useQuery<Credential>({ queryKey: ["credential"] });
  const router = useRouter();

  useEffect(() => {
    if (isLoading || !isFetched) return;
    if (isMiniApp) sdk.actions.ready().catch(reportError);
    SplashScreen.hideAsync().catch(reportError);
  }, [isFetched, isLoading, isMiniApp]);

  useFocusEffect(
    useCallback(() => {
      if (isLoading || !isFetched) return;
      if (credential) router.replace("/(main)/(home)");
    }, [isLoading, isFetched, credential, router]),
  );

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
