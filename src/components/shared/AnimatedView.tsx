import React, { type ComponentPropsWithoutRef } from "react";
import { Platform } from "react-native";
import Animated from "react-native-reanimated";

import { View } from "tamagui";

const ViewWithForwardedRef = ({
  forwardedRef,
  nativeID,
  entering,
  exiting,
  layout,
  ...properties
}: ComponentPropsWithoutRef<typeof View> & {
  entering?: unknown;
  exiting?: unknown;
  forwardedRef?: React.Ref<React.ComponentRef<typeof View>>;
  layout?: unknown;
}) => {
  return <View ref={forwardedRef} {...(Platform.OS === "web" ? {} : { nativeID })} {...properties} />;
};
ViewWithForwardedRef.displayName = "ViewWithForwardedRef";
export default Animated.createAnimatedComponent(ViewWithForwardedRef);
