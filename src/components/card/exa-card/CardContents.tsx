import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";
import { Loader, LockKeyhole, Snowflake } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { AnimatePresence, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import Card from "../../../assets/images/card.svg";
import { useReadPreviewerExactly } from "../../../generated/contracts";
import AnimatedView from "../../shared/AnimatedView";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function CardContents({
  isCredit,
  disabled,
  frozen,
  revealing,
}: {
  isCredit: boolean;
  disabled: boolean;
  frozen: boolean;
  revealing: boolean;
}) {
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });

  const rotation = useSharedValue(0);
  const rStyle = useAnimatedStyle(() => {
    rotation.value += 1;
    const rotationValue = `${(rotation.value % 360).toString()}deg`;
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
      <YStack height="100%" justifyContent="space-between" alignItems="flex-start">
        <AnimatePresence exitBeforeEnter>
          <YStack>
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
                enterStyle={{ opacity: 0, transform: [{ translateX: -100 }] }} // eslint-disable-line react-native/no-inline-styles
                exitStyle={{ opacity: 0, transform: [{ translateX: -100 }] }} // eslint-disable-line react-native/no-inline-styles
                transform={[{ translateX: 0 }]}
              >
                <Text sensitive color="white" title maxFontSizeMultiplier={1}>
                  {(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
                <View>
                  <Text color="white" emphasized caption maxFontSizeMultiplier={1}>
                    AVAILABLE BALANCE
                  </Text>
                </View>
              </View>
            ) : (
              <View
                key="debit"
                animation="moderate"
                enterStyle={{ opacity: 0, transform: [{ translateX: 100 }] }} // eslint-disable-line react-native/no-inline-styles
                exitStyle={{ opacity: 0, transform: [{ translateX: 100 }] }} // eslint-disable-line react-native/no-inline-styles
                transform={[{ translateX: 0 }]}
              >
                <Text sensitive color="white" title maxFontSizeMultiplier={1}>
                  {(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                  })}
                </Text>
                <View>
                  <Text color="white" emphasized caption maxFontSizeMultiplier={1}>
                    AVAILABLE BALANCE
                  </Text>
                </View>
              </View>
            )}
          </YStack>
        </AnimatePresence>
      </YStack>
      <XStack animation="moderate" position="absolute" right={0} left={0} top={0} bottom={0} justifyContent="flex-end">
        <Card
          width="50%"
          height="100%"
          preserveAspectRatio="xMaxYMid"
          {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
        />
      </XStack>
    </XStack>
  );
}
