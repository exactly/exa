import React from "react";
import { Platform } from "react-native";

import { Image } from "expo-image";

import { styled, View } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import Text from "./Text";
import { getTokenLogoURI } from "../../utils/assetLogos";
import { lifiTokensOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";

const StyledImage = styled(Image, {
  name: "AssetLogo",
  cachePolicy: "memory-disk",
  contentFit: "contain",
  transition: Platform.OS === "web" ? "smooth" : undefined,
  placeholderContentFit: "cover",
  borderRadius: "$r_0",
  overflow: "hidden",
  onError: reportError,
});

export default function AssetLogo({ height, symbol, width }: { height: number; symbol?: string; width: number }) {
  const { data: tokens = [] } = useQuery(lifiTokensOptions);
  const chainTokens = tokens.filter((token) => (token.chainId as number) === chain.id);
  const uri = symbol ? getTokenLogoURI(chainTokens, symbol) : undefined;
  if (!uri) {
    return (
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
  }
  return <StyledImage source={{ uri }} width={width} height={height} />;
}
