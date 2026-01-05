import React, { useState } from "react";
import { Platform, useWindowDimensions } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";
import type { SvgProps } from "react-native-svg";
import { View, XStack } from "tamagui";

import BenefitsCard from "./BenefitCard";
import BenefitSheet from "./BenefitSheet";
// cspell:ignore airalo
import AiraloLogo from "../../assets/images/airalo.svg";
import PaxLogo from "../../assets/images/pax.svg";
import VisaLogo from "../../assets/images/visa.svg";
import useAspectRatio from "../../utils/useAspectRatio";
import Text from "../shared/Text";

export interface Benefit {
  id: string;
  partner: string;
  title: string;
  subtitle: string;
  description: string;
  logo: React.ComponentType<SvgProps>;
  termsUrl?: string;
  longTitle?: string;
  linkText?: string;
  buttonText?: string;
  url: string;
}

const BENEFITS: Benefit[] = [
  {
    id: "pax",
    partner: "Pax Assistance",
    title: "Free 30 days travel insurance",
    subtitle: "Travel with peace of mind.",
    description: "Copy your ID and get 30 days of travel insurance for free on Pax Assistance.",
    logo: PaxLogo,
    url: "https://www.paxassistance.com/ar/capitas/exacardcap/",
  },
  {
    // cspell:ignore airalo
    id: "airalo",
    partner: "Airalo",
    title: "20% OFF on eSims",
    subtitle: "Stay connected everywhere",
    description:
      "Stay connected around the world. \n\n Activate your eSIM and get online from anywhere — quickly and easily — with 20% off on Airalo when you pay with your Visa Signature Exa Card. \n\n Available in 200+ countries and regions.",
    logo: AiraloLogo,
    url: "https://airalo.pxf.io/c/6807698/3734384/15608?p.code=exaapp",
    termsUrl: "https://www.airalo.com/more-info/terms-conditions",
  },
  {
    id: "visa",
    partner: "Visa",
    title: "Visa Signature",
    longTitle: "Visa Signature Exa Card benefits",
    subtitle: "A world of benefits",
    description:
      "A world of benefits. \n\n Your Visa Signature Exa Card comes with multiple benefits including access to VIP airport lounges, car rental discounts, travel assistance, and more. \n\n Learn more about all Visa Signature benefits.",
    logo: VisaLogo,
    linkText: "Learn more",
    buttonText: "Go to Visa",
    url: "https://www.visa.com.pr/pague-con-visa/tarjetas/visa-signature.html",
  },
];

export default function BenefitsSection() {
  const [selectedBenefit, setSelectedBenefit] = useState<Benefit>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const progress = useSharedValue(0);
  const aspectRatio = useAspectRatio();

  const { width, height } = useWindowDimensions();

  const CARD_PADDING = 32;
  const carouselWidth = Math.max(
    Platform.OS === "web" ? Math.min(height * aspectRatio, 600) - CARD_PADDING * 2 : width - CARD_PADDING * 2,
    250,
  );

  return (
    <>
      <View backgroundColor="$backgroundSoft" padding="$s4" gap="$s3_5">
        <XStack alignItems="center" justifyContent="center" gap="$s2" paddingTop="$s2">
          <Text emphasized headline flex={1}>
            Benefits
          </Text>
          {BENEFITS.map((_, index) => (
            <View
              key={index}
              backgroundColor="$interactiveDisabled"
              height={4}
              width={index === currentIndex ? 24 : 4}
              borderRadius="$10"
              animation="quick"
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
            onProgressChange={progress}
            onSnapToItem={(index) => setCurrentIndex(index)}
            renderItem={({ item }) => (
              <View paddingHorizontal="$s2">
                <BenefitsCard
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
