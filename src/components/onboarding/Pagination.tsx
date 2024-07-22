import React, { memo } from "react";
import type { DimensionValue } from "react-native";
import { StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";
import { ms } from "react-native-size-matters";
import { useTheme, useWindowDimensions, View } from "tamagui";

import AnimatedView from "../shared/AnimatedView.js";

const PaginationComponent = ({
  index,
  x,
  progress,
  activeColor,
}: {
  index: number;
  x: SharedValue<number>;
  progress: SharedValue<number>;
  activeColor: string;
}) => {
  const { width } = useWindowDimensions();
  const itemWidth = width - ms(40);

  const rPaginatorStyle = useAnimatedStyle(() => {
    const interpolatedWidth = interpolate(
      x.value,
      [(index - 1) * itemWidth, index * itemWidth, (index + 1) * itemWidth],
      [8, 24, 8],
      Extrapolation.CLAMP,
    );

    return {
      width: interpolatedWidth,
      backgroundColor: "rgba(0,0,0,0.1)",
      overflow: "hidden",
    };
  }, [x]);

  const rFillStyle = useAnimatedStyle(() => {
    const isActive = interpolate(
      x.value,
      [(index - 0.5) * itemWidth, index * itemWidth, (index + 0.5) * itemWidth],
      [0, 1, 0],
      Extrapolation.CLAMP,
    );

    return {
      width: isActive ? (((progress.value * 100).toString() + "%") as DimensionValue) : "0%",
      backgroundColor: activeColor,
    };
  }, [progress, x]);

  return (
    <AnimatedView borderRadius={5} height={4} marginHorizontal={5} style={rPaginatorStyle}>
      <AnimatedView style={[StyleSheet.absoluteFill, rFillStyle]} />
    </AnimatedView>
  );
};

interface PaginationProperties {
  length: number;
  x: SharedValue<number>;
  progress: SharedValue<number>;
}

export default memo(function Pagination({ length, x, progress }: PaginationProperties) {
  const theme = useTheme();
  return (
    <View flexDirection="row" alignItems="center" justifyContent="center">
      {Array.from({ length }).map((_, index) => {
        return (
          <PaginationComponent
            key={index}
            index={index}
            x={x}
            progress={progress}
            activeColor={theme.interactiveBaseBrandDefault.val as string}
          />
        );
      })}
    </View>
  );
});
