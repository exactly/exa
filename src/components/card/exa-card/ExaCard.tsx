import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Pressable } from "react-native";
import Animated from "react-native-reanimated";
import { YStack } from "tamagui";

import CardContents from "./CardContents";
import { getCard } from "../../../utils/server";
import View from "../../shared/View";

interface ExaCardProperties {
  disabled?: boolean;
  revealing: boolean;
  frozen: boolean;
  onPress?: () => void;
}

export default function ExaCard({ disabled = false, revealing, frozen, onPress }: ExaCardProperties) {
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
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
