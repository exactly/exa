import React from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { Loader, LockKeyhole, Snowflake } from "@tamagui/lucide-icons";
import { AnimatePresence, XStack, YStack } from "tamagui";

import { zeroAddress } from "viem";

import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";
import { borrowLimit, withdrawLimit } from "@exactly/lib";

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
  disabled: boolean;
  frozen: boolean;
  isCredit: boolean;
  productId?: string;
  revealing: boolean;
}) {
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const {
    t,
    i18n: { language },
  } = useTranslation();

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
                  {`$${(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(language, {
                    style: "decimal",
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`}
                </Text>
                <View>
                  <Text color="white" emphasized caption maxFontSizeMultiplier={1} textTransform="uppercase">
                    {t("Available balance")}
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
                  {`$${(markets ? Number(withdrawLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(
                    language,
                    {
                      style: "decimal",
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    },
                  )}`}
                </Text>
                <View>
                  <Text color="white" emphasized caption maxFontSizeMultiplier={1} textTransform="uppercase">
                    {t("Available balance")}
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
