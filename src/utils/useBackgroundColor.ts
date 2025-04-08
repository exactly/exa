import { useNavigation } from "expo-router";
import { setBackgroundColorAsync } from "expo-system-ui";
import { useEffect, useMemo } from "react";
import { useTheme } from "tamagui";

import reportError from "./reportError";

export default function useBackgroundColor() {
  const navigation = useNavigation();
  const { backgroundSoft } = useTheme();
  const backgroundColor = useMemo(() => backgroundSoft.val, [backgroundSoft.val]);
  useEffect(() => {
    navigation.setOptions({ contentStyle: { backgroundColor } });
    setBackgroundColorAsync(backgroundColor).catch(reportError);
  }, [navigation, backgroundColor]);
}
