import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import React, { useCallback } from "react";
import { ToggleGroup } from "tamagui";

import usePendingOperations from "../../utils/usePendingOperations";
import SafeView from "./SafeView";
import StatusIndicator from "./StatusIndicator";
import Text from "./Text";
import View from "./View";

export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { count } = usePendingOperations();
  const onPress = useCallback(
    (route: BottomTabBarProps["state"]["routes"][number], focused: boolean) => {
      const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
    },
    [navigation],
  );
  return (
    <SafeView flexDirection="row" width="100%" paddingTop={0} backgroundColor="$backgroundSoft" justifyContent="center">
      <ToggleGroup
        borderRadius={0}
        borderTopColor="$borderNeutralSoft"
        borderTopWidth={1}
        type="single"
        unstyled
        justifyContent="space-evenly"
        flexDirection="row"
        flex={1}
      >
        {state.routes.map((route, index) => {
          if (route.name === "loans") return null;
          if (route.name === "swaps") return null;
          if (route.name === "more") return null;
          const { options } = descriptors[route.key] ?? { options: undefined };
          if (!options) throw new Error("no navigation button options found");
          const label = options.title;
          const icon = options.tabBarIcon;
          const focused = state.index === index;
          return (
            <ToggleGroup.Item
              key={route.key}
              borderWidth={0}
              disablePassStyles
              onPress={() => onPress(route, focused)}
              paddingTop="$s3"
              role="button"
              value="center"
              backgroundColor="transparent"
            >
              <View>
                {route.name === "activity" && count > 0 && <StatusIndicator type="notification" />}
                {typeof icon === "function" &&
                  icon({ size: 24, focused, color: focused ? "$uiBrandSecondary" : "$uiNeutralSecondary" })}
              </View>
              <Text textAlign="center" color={focused ? "$uiBrandSecondary" : "$uiNeutralSecondary"}>
                {label}
              </Text>
            </ToggleGroup.Item>
          );
        })}
      </ToggleGroup>
    </SafeView>
  );
}
