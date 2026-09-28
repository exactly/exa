import React from "react";

import { Image as ExpoImage, type ImageProps } from "expo-image";

import { View, type ViewProps } from "tamagui";

export default function Image({
  source,
  contentFit,
  ...properties
}: Omit<ViewProps, "children"> & Pick<ImageProps, "contentFit" | "source">) {
  return (
    <View overflow="hidden" {...properties}>
      <ExpoImage source={source} contentFit={contentFit} style={{ width: "100%", height: "100%" }} />
    </View>
  );
}
