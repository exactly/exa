import React from "react";

import View from "./View";
import useInsets from "../../utils/useInsets";

import type { ViewProperties } from "./View";

export default function SafeView({ children, paddingTop, paddingBottom, ...rest }: ViewProperties) {
  const insets = useInsets();
  const pad = (inset: number, value: ViewProperties["paddingTop"]) =>
    typeof value === "string" && value.split(" ")[0]?.includes(":") ? `${inset}px ${value}` : (value ?? inset);

  return (
    <View
      paddingTop={pad(insets.top, paddingTop)}
      paddingBottom={pad(rest.tab ? 0 : insets.bottom, paddingBottom)}
      paddingLeft={insets.left}
      paddingRight={insets.right}
      backgroundColor="backgroundMild"
      {...rest}
    >
      {children}
    </View>
  );
}
