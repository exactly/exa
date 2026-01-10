import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";
import { borrowLimit, withdrawLimit } from "@exactly/lib";
import { Loader, LockKeyhole, Snowflake } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { AnimatePresence, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import SignatureCard from "../../../assets/images/card-signature.svg";
import Card from "../../../assets/images/card.svg";
import useAccount from "../../../utils/useAccount";
import AnimatedView from "../../shared/AnimatedView";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function CardContents({
  isCredit,
  disabled,
  frozen,
  revealing,
  productId,
}: {
  isCredit: boolean;
  disabled: boolean;
  frozen: boolean;
  revealing: boolean;
  productId?: string;
}) {
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });

  const rotation = useSharedValue(0);
  /* istanbul ignore next */
  const rStyle = useAnimatedStyle(() => {
    rotation.value += 1;
    const rotationValue = `${rotation.value % 360}deg`;
    return { transform: [{ rotate: rotationValue }] };
  });
  return (
    <XStack
      height={160}
      animation="moderate"
      animateOnly={["opacity"]}
      justifyContent="space-between"
      padding="$s4"
      opacity={disabled ? 0.5 : 1}
    >
      <YStack height="100%" justifyContent="space-between" alignItems="flex-start" flex={1} width="100%" zIndex={1}>
        <AnimatePresence exitBeforeEnter>
          <>
            {disabled ? (
              <LockKeyhole size={40} strokeWidth={2} color="white" />
            ) : revealing ? (
              <AnimatedView style={rStyle}>
                <Loader size={40} strokeWidth={2} color="white" />
              </AnimatedView>
            ) : frozen ? (
              <Snowflake size={40} strokeWidth={2} color="white" />
            ) : isCredit ? (
              <View
                key="credit"
                animation="moderate"
                enterStyle={{ opacity: 0, transform: [{ translateX: -100 }] }}
                exitStyle={{ opacity: 0, transform: [{ translateX: -100 }] }}
                transform={[{ translateX: 0 }]}
              >
                <Text sensitive color="white" title maxFontSizeMultiplier={1} numberOfLines={1}>
                  {(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
                <View flexShrink={1} minWidth={0} width="100%">
                  <Text
                    color="white"
                    emphasized
                    caption
                    maxFontSizeMultiplier={1}
                    width="100%"
                    numberOfLines={2}
                    ellipsizeMode="clip"
                  >
                    AVAILABLE BALANCE
                  </Text>
                </View>
              </View>
            ) : (
              <View
                key="debit"
                animation="moderate"
                enterStyle={{ opacity: 0, transform: [{ translateX: 100 }] }}
                exitStyle={{ opacity: 0, transform: [{ translateX: 100 }] }}
                transform={[{ translateX: 0 }]}
              >
                <Text sensitive color="white" title maxFontSizeMultiplier={1} numberOfLines={1}>
                  {(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
                <View flexShrink={1} minWidth={0} width="100%">
                  <Text
                    color="white"
                    emphasized
                    caption
                    maxFontSizeMultiplier={1}
                    width="100%"
                    numberOfLines={2}
                    ellipsizeMode="clip"
                  >
                    AVAILABLE BALANCE
                  </Text>
                </View>
              </View>
            )}
          </>
        </AnimatePresence>
      </YStack>
      <XStack animation="moderate" position="absolute" right={0} left={0} top={0} bottom={0} justifyContent="flex-end">
        {productId === PLATINUM_PRODUCT_ID ? (
          <Card
            width="100%"
            height="100%"
            preserveAspectRatio="xMaxYMid"
            {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
          />
        ) : (
          <SignatureCard
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
