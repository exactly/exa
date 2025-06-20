import React, { useState } from "react";
import { Platform } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";
import { SvgUri, type UriProps } from "react-native-svg";

import AnimatedView from "./AnimatedView";
import Skeleton from "./Skeleton";
import View from "./View";

export default function AssetLogo({ ...properties }: UriProps) {
  const [loading, setLoading] = useState(true);
  return (
    <View borderRadius="$r_0" overflow="hidden">
      {loading && <Skeleton radius="round" height={Number(properties.height)} width={Number(properties.width)} />}
      <AnimatedView
        alignItems="center"
        justifyContent="center"
        display={loading ? "none" : "flex"}
        width={Number(properties.width)}
        height={Number(properties.height)}
        {...(Platform.OS !== "web" && { entering: FadeIn, exiting: FadeOut })}
      >
        <SvgUri
          {...properties}
          onLoad={() => {
            setLoading(false);
          }}
        />
      </AnimatedView>
    </View>
  );
}
