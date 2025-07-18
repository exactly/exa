import type { Credential } from "@exactly/common/validation";
import { useQuery } from "@tanstack/react-query";
import { Redirect, SplashScreen, Stack } from "expo-router";
import React, { useEffect } from "react";

import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useBackgroundColor from "../../utils/useBackgroundColor";

export default function AppLayout() {
  const { error: noCredential, isLoading, isFetched } = useQuery<Credential>({ queryKey: ["credential"] }, queryClient);
  useBackgroundColor();
  useEffect(() => {
    if (isLoading || !isFetched) return;
    SplashScreen.hideAsync().catch(reportError);
  }, [isFetched, isLoading]);
  if (noCredential) return <Redirect href="/onboarding" />;
  if (isLoading || !isFetched) return;
  return <Stack initialRouteName="(home)" screenOptions={{ headerShown: false }} />;
}
