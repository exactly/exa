import React from "react";

import { ToastViewport } from "@tamagui/toast";

import useInsets from "../../utils/useInsets";

export default function SafeToastViewport() {
  const { left, top, right } = useInsets();
  return <ToastViewport top={top || "$s4"} left={left} right={right} />;
}
