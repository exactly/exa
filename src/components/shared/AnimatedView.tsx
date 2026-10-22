import React, { type ComponentPropsWithoutRef } from "react";
import Animated from "react-native-reanimated";

import { View } from "tamagui";

const ViewWithForwardedRef = ({
  forwardedRef,
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
  return <View ref={forwardedRef} {...properties} />;
};
ViewWithForwardedRef.displayName = "ViewWithForwardedRef";
export default Animated.createAnimatedComponent(ViewWithForwardedRef);
