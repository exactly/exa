import React from "react";
import { RefreshControl as RNRefreshControl, type RefreshControlProps } from "react-native";

import { useMutation } from "@tanstack/react-query";

import reportError from "../../utils/reportError";

export default function RefreshControl({
  onRefresh,
  ...properties
}: Omit<RefreshControlProps, "onRefresh" | "refreshing"> & { onRefresh: () => Promise<unknown> }) {
  const { mutate, isPending } = useMutation({ mutationFn: onRefresh, onError: (error) => reportError(error) });
  return <RNRefreshControl refreshing={isPending} onRefresh={() => mutate()} {...properties} />;
}
