import React, { useState } from "react";
import { Platform } from "react-native";

import { Image } from "expo-image";

import { styled, View } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import ChainLogo from "./ChainLogo";
import Text from "./Text";
import { getTokenLogoURI } from "../../utils/assetLogos";
import { lifiTokensOptions } from "../../utils/lifi";

const StyledImage = styled(Image, {
  name: "AssetLogo",
  cachePolicy: "memory-disk",
  contentFit: "contain",
  transition: Platform.OS === "web" ? "smooth" : undefined,
  placeholderContentFit: "cover",
  borderRadius: "$r_0",
  overflow: "hidden",
});

export default function AssetLogo({
  chainId = chain.id,
  height,
  network,
  symbol,
  uri: defaultUri,
  width,
}: {
  chainId?: number;
  height: number;
  network?: boolean;
  symbol?: string;
  uri?: string;
  width: number;
}) {
  const [failed, setFailed] = useState<string>();
  const { data: tokens = [] } = useQuery({ ...lifiTokensOptions, enabled: !defaultUri });
  const source =
    defaultUri ??
    (symbol
      ? getTokenLogoURI(
          tokens.filter((token) => token.chainId === (chainId as typeof token.chainId)),
          symbol,
        )
      : undefined);
  const uri = source === failed ? undefined : source;
  const logo = uri ? (
    <StyledImage
      source={{ uri }}
      width={width}
      height={height}
      onError={() => {
        setFailed(uri);
      }}
    />
  ) : (
    <View
      width={width}
      height={height}
      borderRadius="$r_0"
      backgroundColor="$backgroundStrong"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize={width * 0.4} fontWeight="bold" color="$uiNeutralSecondary">
        {symbol ? symbol.slice(0, 2).toUpperCase() : "—"}
      </Text>
    </View>
  );
  if (!network) return logo;
  return (
    <View width={width} height={height}>
      {logo}
      <View
        position="absolute"
        bottom={-2}
        right={-2}
        borderWidth={1}
        borderColor="$backgroundSoft"
        borderRadius="$r_0"
        overflow="hidden"
      >
        <ChainLogo chainId={chainId} size={Math.min(16, Math.round(width / 2))} />
      </View>
    </View>
  );
}
