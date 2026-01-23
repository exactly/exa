import React from "react";
import { Platform } from "react-native";

import { Image } from "expo-image";

import { styled, View } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import Text from "./Text";
import { getTokenLogoURI } from "../../utils/assetLogos";
import { lifiTokensOptions } from "../../utils/queryClient";
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

export default function AssetLogo({ height, symbol, width }: { height: number; symbol: string; width: number }) {
  const { data: tokens = [] } = useQuery(lifiTokensOptions);
  const uri = getTokenLogoURI(tokens, symbol);
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
          {symbol.slice(0, 2).toUpperCase()}
        </Text>
      </View>
    );
  }
  return <StyledImage source={{ uri }} width={width} height={height} />;
}
