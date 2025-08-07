import { sdk } from "@farcaster/miniapp-sdk";
import React, { useEffect, useState, type ReactNode } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ViewProperties } from "./View";
import View from "./View";
import reportError from "../../utils/reportError";

export default function SafeView({ children, ...rest }: ViewProperties & { children: ReactNode }) {
  const { top, bottom, left, right } = useSafeAreaInsets();
  const [insets, setInsets] = useState<{ top: number; bottom: number; left: number; right: number }>({
    top,
    bottom,
    left,
    right,
  });

  useEffect(() => {
    sdk
      .isInMiniApp()
      .then((isMiniApp) => {
        if (!isMiniApp) {
          setInsets({ top, bottom, left, right });
          return;
        }
        sdk.context
          .then((result) => {
            setInsets({
              top: result.client.safeAreaInsets?.top ?? top,
              bottom: result.client.safeAreaInsets?.bottom ?? bottom,
              left: result.client.safeAreaInsets?.left ?? left,
              right: result.client.safeAreaInsets?.right ?? right,
            });
          })
          .catch(reportError);
      })
      .catch(reportError);
  }, [bottom, left, right, top]);

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
