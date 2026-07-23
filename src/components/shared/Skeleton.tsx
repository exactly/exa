import React from "react";

import { useThemeName } from "tamagui";

import { Skeleton as MotiSkeleton } from "moti/skeleton";

export default function Skeleton({ ...properties }: Parameters<typeof MotiSkeleton>[0]) {
  return <MotiSkeleton {...properties} colorMode={useThemeName() === "dark" ? "dark" : "light"} />;
}
