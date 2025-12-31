import { sdk } from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";
import React, { useLayoutEffect as useClientLayoutEffect, useState } from "react";
import { useSafeAreaInsets, type EdgeInsets } from "react-native-safe-area-context";

import type { ViewProperties } from "./View";
import View from "./View";
import reportError from "../../utils/reportError";

const useLayoutEffect = typeof window === "undefined" ? () => undefined : useClientLayoutEffect;

export default function SafeView({ children, ...rest }: ViewProperties) {
  const deviceInsets = useSafeAreaInsets();
  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const [miniAppInsets, setMiniAppInsets] = useState<EdgeInsets>(deviceInsets);

  useLayoutEffect(() => {
    if (!isMiniApp) return;
    sdk.context
      .then(({ client: { safeAreaInsets } }) => {
        setMiniAppInsets(safeAreaInsets ?? deviceInsets);
      })
      .catch(reportError);
  }, [deviceInsets.top, deviceInsets.bottom, deviceInsets.left, deviceInsets.right, isMiniApp]);

  const insets = isMiniApp ? miniAppInsets : deviceInsets;

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
