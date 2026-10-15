import React from "react";

import View from "./View";
import useInsets from "../../utils/useInsets";

import type { ViewProperties } from "./View";

export default function SafeView({ children, ...rest }: ViewProperties) {
  const insets = useInsets();

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
