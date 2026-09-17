import React, { useEffect } from "react";

import { Stack } from "expo-router";

import { useQuery } from "@tanstack/react-query";

import business from "@exactly/common/business";

import Intro from "../../components/business/Intro";
import Spinner from "../../components/shared/Spinner";
import View from "../../components/shared/View";
import { enablePrompt } from "../../utils/onesignal";
import useBackgroundColor from "../../utils/useBackgroundColor";

import type { KYCStatus } from "../../utils/server";

export default function AppLayout() {
  useBackgroundColor();
  useEffect(() => {
    enablePrompt();
  }, []);
  const { data, isPending } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"], enabled: business });
  if (business && isPending) {
    return (
      <View fullScreen justifyContent="center" alignItems="center" backgroundColor="$backgroundSoft">
        <Spinner />
      </View>
    );
  }
  if (business && data && "code" in data && (data.code === "not started" || data.code === "no kyc")) return <Intro />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
