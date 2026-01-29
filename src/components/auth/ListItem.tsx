import React, { memo } from "react";
import { StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import { View } from "tamagui";

import AnimatedView from "../shared/AnimatedView";

import type { Page } from "./Auth";

type ListItemProperties = {
  animationValue: SharedValue<number>;
  item: Page;
};

function ListItem({ item, animationValue }: ListItemProperties) {
  /* istanbul ignore next */
  const rBackgroundStyle = useAnimatedStyle(() => {
    const animatedScale = interpolate(animationValue.value, [-1, 0, 1], [0.5, 1, 0.5], Extrapolation.CLAMP);
    const interpolatedOpacity = interpolate(animationValue.value, [-1, 0, 1], [0.3, 1, 0.3], Extrapolation.CLAMP);
    return { transform: [{ scale: animatedScale }], opacity: interpolatedOpacity };
  }, [animationValue]);

  /* istanbul ignore next */
  const rImageStyle = useAnimatedStyle(() => {
    const animatedScale = interpolate(animationValue.value, [-1, 0, 1], [0.7, 1, 0.7], Extrapolation.CLAMP);
    return { transform: [{ scale: animatedScale }] };
  }, [animationValue]);

  return (
    <View width="100%" height="100%" justifyContent="center" alignItems="center">
      <AnimatedView style={rBackgroundStyle} width="100%" height="100%">
        <item.backgroundImage width="100%" height="100%" />
      </AnimatedView>
      <AnimatedView style={[StyleSheet.absoluteFillObject, rImageStyle]} width="100%" height="100%">
        <item.image width="100%" height="100%" />
      </AnimatedView>
    </View>
  );
}

export default memo(ListItem);
