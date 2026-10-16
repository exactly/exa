import React, { useEffect, useState } from "react";
import {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { hide, setOptions } from "expo-splash-screen";

import { useTheme, View } from "tamagui";

import AnimatedView from "./AnimatedView";
import Wordmark from "../../assets/images/wordmark.svg";

export default function Splash({ isReady }: { isReady: boolean }) {
  const theme = useTheme();
  const isReducedMotion = useReducedMotion();
  const [isIntroDone, setIsIntroDone] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const intro = useSharedValue(0);
  const exit = useSharedValue(0);
  const zoom = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (!isIntroDone || isReady) return;
    pulse.value = withRepeat(withSequence(withTiming(0.4, breathe), withTiming(1, breathe)), -1);
    return () => {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
    };
  }, [isIntroDone, isReady, pulse]);

  useEffect(() => {
    if (!isIntroDone || !isReady) return;
    /* istanbul ignore next */
    const finish = (finished?: boolean) => {
      "worklet";
      if (finished) scheduleOnRN(setIsDone, true);
    };
    if (isReducedMotion) {
      zoom.value = withTiming(1, { duration: 240 }, finish);
      return;
    }
    exit.value = withDelay(300, withTiming(1, { duration: 380, easing: Easing.bezier(0.65, 0, 0.35, 1) }));
    zoom.value = withDelay(620, withTiming(1, { duration: 560, easing: Easing.bezier(0.33, 0, 0.67, 0) }, finish));
  }, [exit, isIntroDone, isReady, isReducedMotion, zoom]);

  /* istanbul ignore next */
  const overlayStyle = useAnimatedStyle(() => ({
    opacity: interpolate(zoom.value, isReducedMotion ? [0, 1] : [0.3, 1], [1, 0], "clamp"),
  }));
  /* istanbul ignore next */
  const tileStyle = useAnimatedStyle(() => ({
    opacity: interpolate(zoom.value, [0.1, 0.7], [1, 0], "clamp"),
    transform: [
      { translateX: -SHIFT * intro.value * (1 - exit.value) },
      { scale: isReducedMotion ? 1 : 1 - 0.1 * exit.value + zoom.value * 2.3 },
    ],
  }));
  /* istanbul ignore next */
  const barStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: pulse.value }] }));
  /* istanbul ignore next */
  const wordmarkStyle = useAnimatedStyle(() => ({
    opacity: interpolate(intro.value, [0.35, 1], [0, 1], "clamp") * (1 - exit.value),
    transform: [{ translateX: -(1 - intro.value) * (WORDMARK + GAP) - exit.value * GAP }],
  }));

  if (isDone) return null;
  return (
    <AnimatedView
      position="absolute"
      inset={0}
      alignItems="center"
      justifyContent="center"
      backgroundColor="$backgroundSoft"
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={overlayStyle}
      onLayout={() => {
        setOptions({ duration: 0, fade: false });
        hide();
        if (isReducedMotion) {
          setIsIntroDone(true);
          return;
        }
        /* istanbul ignore next */
        intro.value = withDelay(
          120,
          withTiming(1, { duration: 760, easing: Easing.bezier(0.65, 0, 0.35, 1) }, (finished) => {
            if (finished) scheduleOnRN(setIsIntroDone, true);
          }),
        );
      }}
    >
      <View width={TILE} height={TILE}>
        <View
          position="absolute"
          left={TILE + (GAP - WORDMARK) / 2}
          top={(TILE - WORDMARK / 2.5) / 2}
          width={WORDMARK}
          height={WORDMARK / 2.5}
          overflow="hidden"
        >
          <AnimatedView style={wordmarkStyle}>
            <Wordmark width={WORDMARK} height={WORDMARK / 2.5} color={theme.uiNeutralPrimary.val} />
          </AnimatedView>
        </View>
        <AnimatedView
          position="absolute"
          inset={0}
          borderRadius={1.2 * UNIT}
          backgroundColor="$uiNeutralPrimary"
          style={tileStyle}
        >
          {GLYPH.map(([x, y, w, h]) => (
            <View
              key={`${x}-${y}-${w}`}
              position="absolute"
              left={x * UNIT}
              top={y * UNIT}
              width={w * UNIT}
              height={h * UNIT}
              borderRadius={0.4 * UNIT}
              backgroundColor="$backgroundSoft"
            />
          ))}
          <AnimatedView
            position="absolute"
            left={5 * UNIT}
            top={8 * UNIT}
            width={8 * UNIT}
            height={BAR}
            borderRadius={0.4 * UNIT}
            backgroundColor="$backgroundSoft"
            style={barStyle}
          />
        </AnimatedView>
      </View>
    </AnimatedView>
  );
}

const TILE = 96;
const UNIT = TILE / 18;
const BAR = 2 * UNIT;
const GAP = 0.31 * TILE;
const WORDMARK = 1.15 * TILE;
const SHIFT = (GAP + WORDMARK) / 2;
const GLYPH = [
  [3, 3, 12, 2],
  [3, 3, 2, 3],
  [13, 3, 2, 3],
  [3, 13, 12, 2],
  [3, 12, 2, 3],
  [13, 12, 2, 3],
] as const;
const breathe = { duration: 700, easing: Easing.inOut(Easing.sin) };
