import React, { type ComponentPropsWithoutRef } from "react";
import Animated from "react-native-reanimated";
import { View } from "tamagui";

const ViewWithForwardedReference = ({
  forwardedRef,
  ...properties
}: ComponentPropsWithoutRef<typeof View> & {
  forwardedRef?: React.Ref<React.ComponentRef<typeof View> | null>;
}) => {
  return <View ref={forwardedRef} {...properties} />;
};
ViewWithForwardedReference.displayName = "ViewWithForwardedRef";
export default Animated.createAnimatedComponent(ViewWithForwardedReference);
