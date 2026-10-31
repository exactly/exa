import React, { useEffect } from "react";
import { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

import { Loader } from "@tamagui/lucide-icons-2/icons/Loader";

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
  useEffect(() => {
    rotation.value = withRepeat(withTiming(360, { duration: 6000, easing: Easing.linear }), -1);
  }, [rotation]);
  /* istanbul ignore next */
  const rStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(rotation.value)}deg` }] }));
  return (
    <AnimatedView
      backgroundColor={backgroundColor}
      width={containerSize}
      height={containerSize}
      justifyContent="center"
      alignItems="center"
      borderRadius="$r_0"
      style={rStyle}
    >
      <Loader size={size} color={color} />
    </AnimatedView>
  );
}
