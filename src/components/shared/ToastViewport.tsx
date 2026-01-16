import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ToastViewport } from "@tamagui/toast";

export default function SafeToastViewport() {
  const { left, top, right } = useSafeAreaInsets();
  return <ToastViewport top={top} left={left} right={right} />;
}
