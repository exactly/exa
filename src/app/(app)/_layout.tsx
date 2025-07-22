import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";
import { Redirect, SplashScreen, Stack } from "expo-router";
import React, { useEffect } from "react";
import { Spinner } from "tamagui";

import View from "../../components/shared/View";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useBackgroundColor from "../../utils/useBackgroundColor";

export default function AppLayout() {
  const { error: noCredential, isLoading, isFetched } = useQuery<Credential>({ queryKey: ["credential"] }, queryClient);
  useBackgroundColor();
  useEffect(() => {
    if (isLoading || !isFetched) return;
    sdk.actions.ready().catch(reportError);
    SplashScreen.hideAsync().catch(reportError);
  }, [isFetched, isLoading]);
  if (noCredential) return <Redirect href="/onboarding" />;
  if (isLoading || !isFetched) return <Loading />;
  return <Stack initialRouteName="(home)" screenOptions={{ headerShown: false }} />;
}

function Loading() {
  return (
    <View fullScreen padded justifyContent="center" alignItems="center">
      <Spinner width={48} height={48} color="$uiBrandSecondary" />
    </View>
  );
}
