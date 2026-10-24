import React, { type ComponentPropsWithoutRef } from "react";
import { Platform } from "react-native";
import Animated from "react-native-reanimated";

import { View } from "tamagui";

const ViewWithForwardedRef = ({
  forwardedRef,
  nativeID,
  ...properties
}: ComponentPropsWithoutRef<typeof View> & {
  forwardedRef?: React.Ref<React.ComponentRef<typeof View>>;
}) => {
  return <View ref={forwardedRef} {...(Platform.OS === "web" ? {} : { nativeID })} {...properties} />;
};
ViewWithForwardedRef.displayName = "ViewWithForwardedRef";
export default Animated.createAnimatedComponent(ViewWithForwardedRef);
