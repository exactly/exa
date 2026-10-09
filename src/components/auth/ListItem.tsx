import React, { memo } from "react";
import type { SharedValue } from "react-native-reanimated";
import { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import AnimatedView from "../shared/AnimatedView";
import Image from "../shared/Image";

import type { Page } from "./Auth";

type ListItemProperties = {
  animationValue: SharedValue<number>;
  item: Page;
};

function ListItem({ item, animationValue }: ListItemProperties) {
  /* istanbul ignore next */
  const rImageStyle = useAnimatedStyle(() => {
    const animatedScale = interpolate(animationValue.value, [-1, 0, 1], [0.7, 1, 0.7], Extrapolation.CLAMP);
    const interpolatedOpacity = interpolate(animationValue.value, [-1, 0, 1], [0.3, 1, 0.3], Extrapolation.CLAMP);
    return { transform: [{ scale: animatedScale }], opacity: interpolatedOpacity };
  }, [animationValue]);

  return (
    <AnimatedView
      style={rImageStyle}
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      paddingHorizontal="$s7"
    >
      <Image source={item.image} contentFit="contain" width="100%" height="100%" />
    </AnimatedView>
  );
}

export default memo(ListItem);
