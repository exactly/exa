import React from "react";

import { Stack } from "expo-router";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function StatementLayout() {
  useBackgroundColor();
  return <Stack screenOptions={{ headerShown: false }} />;
}
