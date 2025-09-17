import type { Chain } from "@lifi/sdk";
import React from "react";
import { Image } from "react-native";

import OptimismImage from "../../assets/images/optimism.svg";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ChainLogo({
  chainData,
  size = 36,
}: {
  chainData?: Pick<Chain, "id" | "name" | "logoURI">;
  size?: number;
}) {
  if (chainData?.id === 10) {
    return (
      <View width={size} height={size} borderRadius={size / 2} overflow="hidden">
        <OptimismImage width="100%" height="100%" />
      </View>
    );
  }

  if (chainData?.logoURI)
    return <Image source={{ uri: chainData.logoURI }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  const label = chainData?.name[0]?.toUpperCase() ?? "?";
  return (
    <View
      width={size}
      height={size}
      borderRadius={size / 2}
      backgroundColor="$backgroundFocus"
      alignItems="center"
      justifyContent="center"
    >
      <Text subHeadline color="$uiNeutralSecondary">
        {label}
      </Text>
    </View>
  );
}
