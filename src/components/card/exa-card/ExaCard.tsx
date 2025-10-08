import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable } from "react-native";
import Animated from "react-native-reanimated";
import { YStack } from "tamagui";

import CardContents from "./CardContents";
import type { CardDetails } from "../../../utils/card";
import View from "../../shared/View";

export default function ExaCard({
  disabled = false,
  revealing,
  frozen,
  onPress,
}: {
  disabled?: boolean;
  revealing: boolean;
  frozen: boolean;
  onPress?: () => void;
}) {
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  return (
    <AnimatedYStack width="100%" borderRadius="$r4" borderWidth={0}>
      <Pressable onPress={onPress}>
        <View
          zIndex={3}
          backgroundColor="black"
          borderColor="black"
          borderRadius="$r4"
          borderWidth={1}
          overflow="hidden"
        >
          <CardContents
            isCredit={(card && card.mode > 0) ?? false}
            disabled={disabled}
            frozen={frozen}
            revealing={revealing}
          />
        </View>
      </Pressable>
    </AnimatedYStack>
  );
}

const AnimatedYStack = Animated.createAnimatedComponent(YStack);
