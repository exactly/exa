import { sdk } from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ViewProperties } from "./View";
import View from "./View";
import reportError from "../../utils/reportError";

export default function SafeView({ children, ...rest }: ViewProperties) {
  const deviceInsets = useSafeAreaInsets();
  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const { data: miniAppInsets } = useQuery({
    queryKey: ["miniapp-insets"],
    queryFn: async () => {
      try {
        const { client } = await sdk.context;
        return client.safeAreaInsets ?? null;
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    enabled: !!isMiniApp,
    staleTime: Infinity,
    retry: false,
  });

  const insets = isMiniApp && miniAppInsets ? miniAppInsets : deviceInsets;

  return (
    <View
      paddingTop={insets.top}
      paddingBottom={insets.bottom}
      paddingLeft={insets.left}
      paddingRight={insets.right}
      backgroundColor="$backgroundMild"
      {...rest}
    >
      {children}
    </View>
  );
}
