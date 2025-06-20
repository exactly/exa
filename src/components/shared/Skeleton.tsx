import { Skeleton as MotiSkeleton } from "moti/skeleton";
import React from "react";
import { useColorScheme } from "react-native";

export default function Skeleton({ ...properties }: Parameters<typeof MotiSkeleton>[0]) {
  const theme = useColorScheme();
  return <MotiSkeleton {...properties} colorMode={theme ?? "light"} />;
}
