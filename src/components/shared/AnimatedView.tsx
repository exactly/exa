import React, { type ComponentPropsWithoutRef } from "react";
import Animated from "react-native-reanimated";

import { View } from "tamagui";

const ViewWithForwardedRef = ({
  forwardedRef,
  ...properties
}: ComponentPropsWithoutRef<typeof View> & {
  forwardedRef?: React.Ref<React.ComponentRef<typeof View>>;
}) => {
  return <View ref={forwardedRef} {...properties} />;
};
ViewWithForwardedRef.displayName = "ViewWithForwardedRef";
export default Animated.createAnimatedComponent(ViewWithForwardedRef);
