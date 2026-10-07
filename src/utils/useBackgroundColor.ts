import { useEffect } from "react";

import { setBackgroundColorAsync } from "expo-system-ui";

import { useTheme } from "tamagui";

import reportError from "./reportError";

export default function useBackgroundColor() {
  const { backgroundSoft } = useTheme();
  const backgroundColor = backgroundSoft.val;
  useEffect(() => {
    setBackgroundColorAsync(backgroundColor).catch(reportError);
  }, [backgroundColor]);
}
