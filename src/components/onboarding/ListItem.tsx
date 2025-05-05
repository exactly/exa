import React, { memo } from "react";
import { Platform, StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";
import { View, useWindowDimensions } from "tamagui";

import type { Page } from "./Carousel";
import AnimatedView from "../shared/AnimatedView";

export default memo(function ListItem({ item, index, x }: { item: Page; index: number; x: SharedValue<number> }) {
  const { width, height } = useWindowDimensions();
  const itemWidth = Platform.OS === "web" ? height * (10 / 16) : width;
  const rBackgroundStyle = useAnimatedStyle(() => {
    const animatedScale = interpolate(
      x.value,
      [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    const interpolatedOpacity = interpolate(
      x.value,
      [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scale: animatedScale }], opacity: interpolatedOpacity };
  }, [index, x]);
  const rImageStyle = useAnimatedStyle(() => {
    const animatedScale = interpolate(
      x.value,
      [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth],
      [0.5, 1, 0.5],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scale: animatedScale }] };
  }, [index, x]);
  return (
    <View
      width={itemWidth}
      aspectRatio={Platform.OS === "web" ? 16 / 10 : 1}
      justifyContent="center"
      alignItems="center"
    >
      <AnimatedView style={rBackgroundStyle} width="100%" height="100%">
        <item.backgroundImage width="100%" height="100%" />
      </AnimatedView>
      <AnimatedView style={[StyleSheet.absoluteFillObject, rImageStyle]} width="100%" height="100%">
        <item.image width="100%" height="100%" />
      </AnimatedView>
    </View>
  );
});
