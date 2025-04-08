import { exaPreviewerAddress } from "@exactly/common/generated/chain";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { NavigationRoute } from "@sentry/react-native/dist/js/tracing/reactnavigation";
import React, { useCallback } from "react";
import { ms } from "react-native-size-matters";
import { ToggleGroup } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import SafeView from "./SafeView";
import StatusIndicator from "./StatusIndicator";
import Text from "./Text";
import View from "./View";
import { useReadExaPreviewerPendingProposals } from "../../generated/contracts";
export default function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { address } = useAccount();
  const { data: pendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: {
      enabled: !!address,
      gcTime: 0,
      refetchInterval: 30_000,
    },
  });

  const onPress = useCallback(
    (route: NavigationRoute, focused: boolean) => {
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
          const { options } = descriptors[route.key] ?? { options: undefined };
          if (!options) throw new Error("no navigation button options found");
          const label = options.title;
          const icon = options.tabBarIcon;
          const focused = state.index === index;
          return (
            <ToggleGroup.Item
              key={route.key}
              borderWidth={0}
              onPress={() => {
                onPress(route, focused);
              }}
              paddingTop="$s3"
              role="button"
              value="center"
              backgroundColor="transparent"
            >
              <View>
                {label === "Activity" && pendingProposals && pendingProposals.length > 0 && (
                  <StatusIndicator type="notification" />
                )}
                {typeof icon === "function" &&
                  icon({ size: ms(24), focused, color: focused ? "$uiBrandSecondary" : "$uiNeutralSecondary" })}
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
