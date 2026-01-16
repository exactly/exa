import { SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { useRouter } from "expo-router";
import React from "react";
import { Platform } from "react-native";
import { XStack, YStack } from "tamagui";

import SignatureCard from "../../assets/images/card-signature.svg";
import Card from "../../assets/images/card.svg";
import CardLimits from "./CardLimits";

export default function CardStatus({ onInfoPress, productId }: { onInfoPress: () => void; productId: string }) {
  const router = useRouter();
  return (
    <XStack
      backgroundColor={productId === SIGNATURE_PRODUCT_ID ? "$grayscaleLight12" : "black"}
      borderRadius="$r4"
      alignItems="center"
      overflow="hidden"
      height={136}
      justifyContent="space-between"
      padding="$s4"
    >
      <YStack height="100%" justifyContent="space-between" alignItems="flex-start" zIndex={2}>
        <CardLimits onPress={onInfoPress} />
      </YStack>
      <XStack
        position="absolute"
        right={0}
        left={0}
        top={0}
        bottom={0}
        justifyContent="flex-end"
        cursor="pointer"
        onPress={() => {
          router.push("/card");
        }}
      >
        {productId === SIGNATURE_PRODUCT_ID ? (
          <SignatureCard
            width="100%"
            height="100%"
            preserveAspectRatio="xMaxYMid"
            {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
          />
        ) : (
          <Card
            width="100%"
            height="100%"
            preserveAspectRatio="xMaxYMid"
            {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
          />
        )}
      </XStack>
    </XStack>
  );
}
