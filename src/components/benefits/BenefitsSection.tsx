import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, StyleSheet, useWindowDimensions } from "react-native";
import type { SharedValue } from "react-native-reanimated";
import { Extrapolation, interpolate, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";

import { useTheme, View, XStack } from "tamagui";

import BenefitCard from "./BenefitCard";
import BenefitSheet from "./BenefitSheet";
import AiraloLogo from "../../assets/images/airalo.svg";
import PaxLogo from "../../assets/images/pax.svg";
import VisaLogo from "../../assets/images/visa.svg";
import useAspectRatio from "../../utils/useAspectRatio";
import AnimatedView from "../shared/AnimatedView";
import Text from "../shared/Text";

const BENEFITS = [
  {
    id: "pax",
    partner: "Pax Assistance",
    title: "30 days of free travel insurance",
    subtitle: "Travel with peace of mind.",
    descriptions: ["Copy your ID and get 30 days of travel insurance for free on Pax Assistance."],
    logo: PaxLogo,
    url: "https://www.paxassistance.com/{locale}/capitas/exacardcap/",
  },
  {
    id: "airalo",
    partner: "Airalo",
    title: "20% OFF on eSims",
    subtitle: "Stay connected everywhere",
    descriptions: [
      "Stay connected around the world.",
      "Activate your eSIM and get online from anywhere with 20% off on Airalo.",
      "Available in 200+ countries and regions.",
    ],
    logo: AiraloLogo,
    url: "https://airalo.pxf.io/c/6807698/3734384/15608?p.code=exaapp",
    termsURL: "https://www.airalo.com/more-info/terms-conditions",
  },
  {
    id: "visa",
    partner: "Visa",
    title: "Visa Signature benefits",
    longTitle: "Visa Signature Exa Card benefits",
    subtitle: "Access exclusive discounts",
    descriptions: [
      "A world of benefits.",
      "Your Visa Signature Exa Card comes with multiple benefits including car rental discounts, travel assistance, and more.",
      "Learn more about all Visa Signature benefits.",
    ],
    logo: VisaLogo,
    linkText: "Learn more",
    buttonText: "Go to Visa",
    url: "https://www.visa.com.pr/pague-con-visa/tarjetas/visa-signature.html",
  },
];

export type Benefit = (typeof BENEFITS)[number];

const styles = StyleSheet.create({ dot: { height: 8, borderRadius: 10 } });

/* istanbul ignore next */
function calculateDistance(scrollOffset: number, index: number, length: number) {
  "worklet";
  const normalizedOffset = ((scrollOffset % length) + length) % length;
  let distance = Math.abs(normalizedOffset - index);
  if (distance > length / 2) {
    distance = length - distance;
  }
  return distance;
}

function PaginationDot({
  index,
  scrollOffset,
  activeColor,
  inactiveColor,
}: {
  activeColor: string;
  inactiveColor: string;
  index: number;
  scrollOffset: SharedValue<number>;
}) {
  const length = BENEFITS.length;

  /* istanbul ignore next */
  const rStyle = useAnimatedStyle(() => {
    const distance = calculateDistance(scrollOffset.value, index, length);
    const width = interpolate(distance, [0, 1], [20, 8], Extrapolation.CLAMP);
    const opacity = interpolate(distance, [0, 1], [1, 0.4], Extrapolation.CLAMP);
    return { width, opacity };
  }, [scrollOffset, index, length]);

  /* istanbul ignore next */
  const rColorStyle = useAnimatedStyle(() => {
    const distance = calculateDistance(scrollOffset.value, index, length);
    const isActive = distance < 0.5;
    return { backgroundColor: isActive ? activeColor : inactiveColor };
  }, [scrollOffset, index, activeColor, inactiveColor]);

  return <AnimatedView style={[styles.dot, rStyle, rColorStyle]} />;
}

export default function BenefitsSection() {
  const { t } = useTranslation();
  const theme = useTheme();
  const [selectedBenefit, setSelectedBenefit] = useState<Benefit>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const scrollOffset = useSharedValue(0);
  const aspectRatio = useAspectRatio();

  const { width, height } = useWindowDimensions();

  const carouselWidth = Math.max(Platform.OS === "web" ? Math.min(height * aspectRatio, 600) - 64 : width - 64, 250);

  const handleProgressChange = useCallback(
    (_: number, absoluteProgress: number) => {
      scrollOffset.value = absoluteProgress;
    },
    [scrollOffset],
  );

  return (
    <>
      <View backgroundColor="$backgroundSoft" padding="$s4" gap="$s3_5">
        <XStack alignItems="center" justifyContent="center" gap="$s2" paddingTop="$s2">
          <Text emphasized headline flex={1}>
            {t("Benefits")}
          </Text>
          {BENEFITS.map((benefit, index) => (
            <PaginationDot
              key={benefit.id}
              index={index}
              scrollOffset={scrollOffset}
              activeColor={theme.interactiveBaseBrandDefault.val}
              inactiveColor={theme.interactiveDisabled.val}
            />
          ))}
        </XStack>
        <View>
          <Carousel
            width={carouselWidth}
            height={160}
            data={BENEFITS}
            autoPlay
            autoPlayInterval={5000}
            scrollAnimationDuration={500}
            onProgressChange={handleProgressChange}
            renderItem={({ item }) => (
              <View paddingHorizontal="$s2">
                <BenefitCard
                  benefit={item}
                  onPress={() => {
                    setSelectedBenefit(item);
                    setSheetOpen(true);
                  }}
                />
              </View>
            )}
          />
        </View>
      </View>
      <BenefitSheet benefit={selectedBenefit} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
