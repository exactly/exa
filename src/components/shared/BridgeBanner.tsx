import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useRouter } from "expo-router";

import { XStack, type ColorTokens } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { alchemyChains } from "@exactly/common/generated/chain";

import AnimatedView from "./AnimatedView";
import AssetLogo from "./AssetLogo";
import ChainLogo from "./ChainLogo";
import Text from "./Text";
import View from "./View";
import estimate from "../../utils/estimate";
import { lifiChainsOptions } from "../../utils/lifi";

import type { Bridge } from "../../utils/useBridges";

export default function BridgeBanner({ bridge, now }: { bridge: Bridge; now: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const name = useChainName();
  const { toToken, fromChain, toChain, timestamp, duration } = bridge;
  const remaining = timestamp + duration * 1000 - now;
  const [background, color] = palette(warns(bridge, now));
  const minutes = Math.ceil(remaining / 60_000);
  const values = { symbol: toToken.symbol, from: name(fromChain), to: name(toChain) };
  return (
    <View
      accessible
      role="button"
      aria-label={
        remaining > 0
          ? t("{{symbol}} on its way from {{from}} to {{to}}, about {{count}} min", { ...values, count: minutes })
          : t("{{symbol}} on its way from {{from}} to {{to}}, delayed", values)
      }
      backgroundColor={background}
      cursor="pointer"
      onPress={() => {
        router.push("/pending-proposals");
      }}
    >
      <XStack alignItems="center" gap="s3" paddingVertical="s3" paddingHorizontal="s4">
        <AssetLogo uri={toToken.logoURI} symbol={toToken.symbol} chainId={toChain} width={16} height={16} />
        <Text emphasized footnote color={color}>
          {toToken.symbol}
        </Text>
        <ChainLogo chainId={fromChain} size={16} />
        <Text footnote color={color}>
          →
        </Text>
        <ChainLogo chainId={toChain} size={16} />
        <View flex={1} />
        <Text footnote color={color} flexShrink={1} textAlign="right">
          {remaining > 0 ? t("~{{minutes}} min", { minutes }) : t("Delayed")}
        </Text>
      </XStack>
      <Progress color={color} duration={duration} now={now} timestamp={timestamp} />
    </View>
  );
}

export function warns({ duration, timestamp }: Bridge, now: number) {
  return timestamp + duration * 1000 <= now || estimate(duration).slow;
}

export function palette(warning: boolean) {
  return warning
    ? (["interactiveBaseWarningSoftDefault", "interactiveOnBaseWarningSoft"] as const)
    : (["interactiveBaseInformationSoftDefault", "interactiveOnBaseInformationSoft"] as const);
}

export function useChainName() {
  const { data: chains } = useQuery(lifiChainsOptions);
  return (id: number) => chains?.find((item) => item.id === id)?.name ?? alchemyChains.get(id)?.name ?? String(id);
}

export function useNow(bridges: Bridge[]) {
  const [now, setNow] = useState(Date.now);
  const active = bridges.length > 0;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [active]);
  return Math.max(now, ...bridges.map(({ timestamp }) => timestamp));
}

export function Progress({
  color,
  duration,
  now,
  timestamp,
}: {
  color: ColorTokens;
  duration: number;
  now: number;
  timestamp: number;
}) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const shimmer = useSharedValue(0);
  useEffect(() => {
    const span = duration * 1000;
    const elapsed = Date.now() - timestamp;
    progress.value = span ? Math.min(1, elapsed / span) : 1;
    if (!reduced) progress.value = withTiming(1, { duration: Math.max(0, span - elapsed), easing: Easing.linear });
  }, [duration, now, progress, reduced, timestamp]);
  useEffect(() => {
    if (!reduced) shimmer.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1);
  }, [reduced, shimmer]);
  /* istanbul ignore next */
  const fill = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  /* istanbul ignore next */
  const glow = useAnimatedStyle(() => ({ transform: [{ translateX: `${shimmer.value * 433 - 100}%` }] }));
  return (
    <View height={3}>
      <View style={StyleSheet.absoluteFill} backgroundColor={color} opacity={0.2} />
      <AnimatedView
        position="absolute"
        top={0}
        bottom={0}
        left={0}
        overflow="hidden"
        backgroundColor={color}
        style={fill}
      >
        {!reduced && (
          <AnimatedView
            position="absolute"
            top={0}
            bottom={0}
            left={0}
            width="30%"
            backgroundColor="backgroundSoft"
            opacity={0.5}
            style={glow}
          />
        )}
      </AnimatedView>
    </View>
  );
}
