import React from "react";

import { YStack } from "tamagui";
import type { RadiusTokens } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import Image from "./Image";
import Text from "./Text";
import { lifiChainsOptions } from "../../utils/lifi";

export default function ChainLogo({
  chainId,
  size,
  borderRadius = "$r_0",
}: {
  borderRadius?: RadiusTokens;
  chainId?: number;
  size: number;
}) {
  const targetChainId = chainId ?? chain.id;
  const { data } = useQuery({
    ...lifiChainsOptions,
    select: (chains) => chains.find((c) => c.id === targetChainId),
  });
  if (!data?.logoURI) {
    const name = data?.name ?? chain.name;
    return (
      <YStack
        width={size}
        height={size}
        borderRadius={borderRadius}
        backgroundColor="$backgroundStrong"
        alignItems="center"
        justifyContent="center"
      >
        <Text fontSize={size * 0.4} fontWeight="bold" color="$uiNeutralSecondary">
          {name.slice(0, 2).toUpperCase()}
        </Text>
      </YStack>
    );
  }
  return (
    <Image source={{ uri: data.logoURI }} width={size} height={size} borderRadius={borderRadius} overflow="hidden" />
  );
}
