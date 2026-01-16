import React from "react";
import { Pressable } from "react-native";

import { YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";

import CardContents from "./CardContents";
import View from "../../shared/View";

import type { CardDetails } from "../../../utils/server";

export default function ExaCard({
  disabled = false,
  revealing,
  frozen,
  onPress,
}: {
  disabled?: boolean;
  frozen: boolean;
  onPress?: () => void;
  revealing: boolean;
}) {
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  return (
    <YStack width="100%" borderRadius="$r4" borderWidth={0}>
      <Pressable onPress={onPress}>
        <View
          zIndex={3}
          backgroundColor={card?.productId === PLATINUM_PRODUCT_ID ? "black" : "$grayscaleLight12"}
          borderColor={card?.productId === PLATINUM_PRODUCT_ID ? "black" : "$grayscaleLight12"}
          borderRadius="$r4"
          borderWidth={1}
          overflow="hidden"
        >
          <CardContents
            isCredit={(card && card.mode > 0) ?? false}
            disabled={disabled}
            frozen={frozen}
            revealing={revealing}
            productId={card?.productId}
          />
        </View>
      </Pressable>
    </YStack>
  );
}
