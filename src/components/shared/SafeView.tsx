import { sdk } from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";
import React, { useLayoutEffect as useClientLayoutEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ViewProperties } from "./View";
import View from "./View";
import reportError from "../../utils/reportError";

const useLayoutEffect = typeof window === "undefined" ? () => undefined : useClientLayoutEffect;

export default function SafeView({ children, ...rest }: ViewProperties) {
  const { top, bottom, left, right } = useSafeAreaInsets();
  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const [insets, setInsets] = useState<{ top: number; bottom: number; left: number; right: number }>({
    top,
    bottom,
    left,
    right,
  });
  useLayoutEffect(() => {
    if (isMiniApp) {
      sdk.context
        .then(({ client: { safeAreaInsets } }) => {
          setInsets({
            top: safeAreaInsets?.top ?? top,
            bottom: safeAreaInsets?.bottom ?? bottom,
            left: safeAreaInsets?.left ?? left,
            right: safeAreaInsets?.right ?? right,
          });
        })
        .catch(reportError);
    } else {
      setInsets({ top, bottom, left, right });
    }
  }, [bottom, left, right, top, isMiniApp]);
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
