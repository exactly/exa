import React, { useState } from "react";
import { AppState, RefreshControl as RNRefreshControl, type RefreshControlProps } from "react-native";

import { useNavigation } from "expo-router";

import { useMutation } from "@tanstack/react-query";

import reportError from "../../utils/reportError";
import { check, reload, settle } from "../../utils/update";

export default function RefreshControl({
  onRefresh,
  reloads = false,
  ...properties
}: Omit<RefreshControlProps, "onRefresh" | "refreshing"> & { onRefresh: () => Promise<unknown>; reloads?: boolean }) {
  const navigation = useNavigation();
  const [reloading, setReloading] = useState(false);
  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      check().catch(reportError);
      return Promise.all([onRefresh(), reloads ? settle() : undefined]);
    },
    onError: (error) => reportError(error),
  });
  return (
    <RNRefreshControl
      refreshing={isPending || reloading}
      onRefresh={() => {
        mutate(undefined, {
          onSettled: () => {
            if (!reloads || AppState.currentState !== "active" || !navigation.isFocused()) return;
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
