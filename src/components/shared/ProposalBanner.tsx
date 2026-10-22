import React from "react";
import { useTranslation } from "react-i18next";
import { FadeIn, FadeOut } from "react-native-reanimated";

import { useRouter } from "expo-router";

import { XStack } from "tamagui";

import AssetLogo from "./AssetLogo";
import BridgeBanner, { palette, Progress, useNow, warns } from "./BridgeBanner";
import { ChevronRight } from "../../generated/icons/ChevronRight";
import useBridges from "../../utils/useBridges";
import usePendingOperations from "../../utils/usePendingOperations";
import AnimatedView from "../shared/AnimatedView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Bridge } from "../../utils/useBridges";

function ProposalBanner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { count: requests } = usePendingOperations();
  const bridges = useBridges();
  const now = useNow(bridges);
  const count = requests + bridges.length;
  if (count === 0) return null;
  const [first] = bridges;
  if (first && bridges.length === 1 && requests === 0) return <BridgeBanner bridge={first} now={now} />;
  const [last] = [...bridges].sort((a, b) => end(b) - end(a));
  const [background, color] = palette(bridges.some((bridge) => warns(bridge, now)));
  const remaining = last ? end(last) - now : 0;
  const minutes = Math.ceil(remaining / 60_000);
  return (
    <AnimatedView
      entering={FadeIn}
      exiting={FadeOut}
      accessible
      role="button"
      aria-label={
        last
          ? remaining > 0
            ? t("{{count}} pending operations, about {{minutes}} min", { count, minutes })
            : t("{{count}} pending operations, delayed", { count })
          : t("{{count}} pending operations", { count })
      }
      backgroundColor={background}
      cursor="pointer"
      onPress={() => {
        router.push("/pending-proposals");
      }}
    >
      <XStack alignItems="center" gap="s3" paddingVertical="s3" paddingHorizontal="s4">
        {bridges.length > 0 && (
          <XStack>
            {bridges.map(({ id, toToken, toChain }, index) => (
              <View key={id} marginLeft={index ? -5 : 0} borderRadius="r_0" borderWidth={1.5} borderColor={background}>
                <AssetLogo uri={toToken.logoURI} symbol={toToken.symbol} chainId={toChain} width={16} height={16} />
              </View>
            ))}
          </XStack>
        )}
        <Text emphasized footnote color={color} flexShrink={1}>
          {t("Pending operations → {{count}}", { count })}
        </Text>
        <View flex={1} />
        {last && (
          <Text footnote color={color} flexShrink={0}>
            {remaining > 0 ? t("~{{minutes}} min", { minutes }) : t("Delayed")}
          </Text>
        )}
        <ChevronRight size={16} color={color} />
      </XStack>
      {last && <Progress color={color} duration={last.duration} now={now} timestamp={last.timestamp} />}
    </AnimatedView>
  );
}

function end({ timestamp, duration }: Bridge) {
  return timestamp + duration * 1000;
}

export default ProposalBanner;
