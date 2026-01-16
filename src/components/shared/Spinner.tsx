import React from "react";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { Loader } from "@tamagui/lucide-icons";

import AnimatedView from "./AnimatedView";

export default function Spinner({
  color = "$uiBrandSecondary",
  backgroundColor = "$backgroundStrong",
  containerSize = 88,
  size = 56,
}: {
  backgroundColor?: string;
  color?: string;
  containerSize?: number;
  size?: number;
}) {
  const rotation = useSharedValue(0);
  /* istanbul ignore next */
  const rStyle = useAnimatedStyle(() => {
    rotation.value += 1;
    const rotationValue = `${String(rotation.value % 360)}deg`;
    return { transform: [{ rotate: rotationValue }] };
  });
  return (
    <AnimatedView
      backgroundColor={backgroundColor}
      width={containerSize}
      height={containerSize}
      justifyContent="center"
      alignItems="center"
      borderRadius="$r_0"
      padding="$5"
      style={rStyle}
    >
      <Loader size={size} color={color} />
    </AnimatedView>
  );
}
