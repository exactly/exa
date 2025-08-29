import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import type { ParamListBase } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useQuery } from "@tanstack/react-query";
import { SplashScreen, Stack, useFocusEffect, useNavigation } from "expo-router";
import Head from "expo-router/head";
import React, { useCallback, useEffect } from "react";
import { Platform } from "react-native";

import type { AppNavigationProperties } from "../(main)/_layout";
import reportError from "../../utils/reportError";
import useBackgroundColor from "../../utils/useBackgroundColor";

export default function OnboardingLayout() {
  useBackgroundColor();

  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const { data: credential, isLoading, isFetched } = useQuery<Credential>({ queryKey: ["credential"] });
  const navigation = useNavigation<AppNavigationProperties>();

  useEffect(() => {
    if (isLoading || !isFetched) return;
    if (isMiniApp) sdk.actions.ready().catch(reportError);
    SplashScreen.hideAsync().catch(reportError);
  }, [isFetched, isLoading, credential, navigation, isMiniApp]);

  useFocusEffect(
    useCallback(() => {
      if (isLoading || !isFetched) return;
      if (credential) navigation.replace("(main)");
    }, [isFetched, isLoading, credential, navigation]),
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

export type OnboardingNavigationProperties = NativeStackNavigationProp<OnboardingParameterList>;
export interface OnboardingParameterList extends ParamListBase {
  index: undefined;
  success: undefined;
  "(passkeys)/passkeys": undefined;
  "(passkeys)/about": undefined;
}
