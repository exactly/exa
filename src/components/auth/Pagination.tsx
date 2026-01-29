import React, { memo } from "react";
import { StyleSheet } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import { useTheme, XStack } from "tamagui";

import AnimatedView from "../shared/AnimatedView";

/* istanbul ignore next */
function calculateDistance(scrollOffset: number, index: number, length: number) {
  "worklet";
  const normalizedOffset = ((scrollOffset % length) + length) % length;
  let distance = Math.abs(normalizedOffset - index);
  if (distance > length / 2) {
    distance = length - distance;
  }
  return distance;
}

function PaginationComponent({
  index,
  length,
  scrollOffset,
  progress,
  isScrolling,
  activeColor,
}: {
  activeColor: string;
  index: number;
  isScrolling?: SharedValue<boolean>;
  length: number;
  progress?: SharedValue<number>;
  scrollOffset: SharedValue<number>;
}) {
  /* istanbul ignore next */
  const rContainerStyle = useAnimatedStyle(() => {
    const distance = calculateDistance(scrollOffset.value, index, length);
    const width = interpolate(distance, [0, 1, 2], [24, 8, 8], Extrapolation.CLAMP);
    return { width };
  }, [scrollOffset, index, length]);

  /* istanbul ignore next */
  const rFillStyle = useAnimatedStyle(() => {
    if (!progress) return { width: "0%", backgroundColor: activeColor };
    if (isScrolling?.value) return { width: "0%", backgroundColor: activeColor };

    const distance = calculateDistance(scrollOffset.value, index, length);
    const isSettled = distance < 0.05;

    return {
      width: isSettled ? `${progress.value * 100}%` : "0%",
      backgroundColor: activeColor,
    };
  }, [scrollOffset, progress, isScrolling, index, length, activeColor]);

  return (
    <AnimatedView style={[styles.dot, rContainerStyle]} backgroundColor="$uiNeutralTertiary">
      <AnimatedView style={[StyleSheet.absoluteFill, rFillStyle]} />
    </AnimatedView>
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: 4,
    height: 4,
    overflow: "hidden",
  },
});

function Pagination({
  length,
  scrollOffset,
  progress,
  isScrolling,
}: {
  isScrolling?: SharedValue<boolean>;
  length: number;
  progress?: SharedValue<number>;
  scrollOffset: SharedValue<number>;
}) {
  const theme = useTheme();
  return (
    <XStack alignItems="center" justifyContent="center" gap="$s2">
      {Array.from({ length }).map((_, index) => (
        <PaginationComponent
          key={index} // eslint-disable-line @eslint-react/no-array-index-key
          index={index}
          length={length}
          scrollOffset={scrollOffset}
          progress={progress}
          isScrolling={isScrolling}
          activeColor={theme.interactiveBaseBrandDefault.val}
        />
      ))}
    </XStack>
  );
}

export default memo(Pagination);
