import { Stack } from "expo-router";
import React from "react";

import useBackgroundColor from "../../../utils/useBackgroundColor";

export default function LoanLayout() {
  useBackgroundColor();
  return <Stack screenOptions={{ headerShown: false }} />;
}
