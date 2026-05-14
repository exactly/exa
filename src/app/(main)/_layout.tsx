import React, { useEffect } from "react";

import { Stack } from "expo-router";

import { useQuery } from "@tanstack/react-query";
import { useConnection } from "wagmi";

import Auth from "../../components/auth/Auth";
import { enablePrompt } from "../../utils/onesignal";
import useBackgroundColor from "../../utils/useBackgroundColor";
import ownerConfig from "../../utils/wagmi/owner";

import type { AuthMethod } from "../../utils/queryClient";
import type { Credential } from "@exactly/common/validation";

export default function AppLayout() {
  useBackgroundColor();
  useEffect(() => {
    enablePrompt();
  }, []);
  const { data: method } = useQuery<AuthMethod>({ queryKey: ["method"] });
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const owner = useConnection({ config: ownerConfig });
  if (method === "siwe" && credential && !owner.isConnected && ownerConfig.state.current === null) return <Auth />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
