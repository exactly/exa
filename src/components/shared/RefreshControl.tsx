import React, { useState } from "react";
import { AppState, RefreshControl as RNRefreshControl, type RefreshControlProps } from "react-native";

import { useNavigation } from "expo-router";

import { useMutation } from "@tanstack/react-query";

import reportError from "../../utils/reportError";
import { check, reload } from "../../utils/update";

export default function RefreshControl({
  onRefresh,
  ...properties
}: Omit<RefreshControlProps, "onRefresh" | "refreshing"> & { onRefresh: () => Promise<unknown> }) {
  const navigation = useNavigation();
  const [reloading, setReloading] = useState(false);
  const { mutate, isPending } = useMutation({
    mutationFn: () => Promise.all([onRefresh(), check()]),
    onError: (error) => reportError(error),
  });
  return (
    <RNRefreshControl
      refreshing={isPending || reloading}
      onRefresh={() => {
        mutate(undefined, {
          onSettled: () => {
            if (AppState.currentState !== "active" || !navigation.isFocused()) return;
            setReloading(true);
            reload()
              .then((reloaded) => {
                if (!reloaded) setReloading(false);
              })
              .catch(reportError);
          },
        });
      }}
      {...properties}
    />
  );
}
