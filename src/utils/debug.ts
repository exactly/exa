import React from "react";
import { LogBox } from "react-native";

import type WDYR from "@welldone-software/why-did-you-render";

if (__DEV__) {
  const whyDidYouRender = require("@welldone-software/why-did-you-render") as typeof WDYR; // eslint-disable-line unicorn/prefer-module -- dynamic and sync
  whyDidYouRender(React, { trackAllPureComponents: false, trackHooks: true, logOnDifferentValues: true });
}

if (process.env.EXPO_PUBLIC_ENV === "e2e") {
  LogBox.ignoreAllLogs();
  ErrorUtils.setGlobalHandler((error) => console.error(error)); // eslint-disable-line no-console
}
