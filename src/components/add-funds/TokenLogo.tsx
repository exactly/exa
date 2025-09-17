import type { Token } from "@lifi/sdk";
import React from "react";
import { Image } from "react-native";

import Text from "../shared/Text";
import View from "../shared/View";

export default function TokenLogo({ token, size = 36 }: { token?: Token; size?: number }) {
  if (token?.logoURI)
    return <Image source={{ uri: token.logoURI }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  const label = token?.symbol[0]?.toUpperCase() ?? "?";
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
