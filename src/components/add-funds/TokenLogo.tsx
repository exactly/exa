import React from "react";

import Image from "../shared/Image";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Token } from "@lifi/sdk";

export default function TokenLogo({ token, size = 36 }: { size?: number; token?: Token }) {
  if (token?.logoURI)
    return <Image source={{ uri: token.logoURI }} width={size} height={size} borderRadius={size / 2} />;
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
