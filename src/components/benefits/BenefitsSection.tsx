import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, useWindowDimensions } from "react-native";
import Carousel from "react-native-reanimated-carousel";
import { XStack, View } from "tamagui";

import BenefitCard from "./BenefitCard";
import BenefitSheet from "./BenefitSheet";
import AiraloLogo from "../../assets/images/airalo.svg";
import PaxLogo from "../../assets/images/pax.svg";
import VisaLogo from "../../assets/images/visa.svg";
import useAspectRatio from "../../utils/useAspectRatio";
import Text from "../shared/Text";

const BENEFITS = [
  {
    id: "pax",
    partner: "Pax Assistance",
    title: "30 days of free travel insurance",
    subtitle: "Travel with peace of mind.",
    description: "Copy your ID and get 30 days of travel insurance for free on Pax Assistance.",
    logo: PaxLogo,
    url: "https://www.paxassistance.com/ar/capitas/exacardcap/",
  },
  {
    id: "airalo",
    partner: "Airalo",
    title: "20% OFF on eSims",
    subtitle: "Stay connected everywhere",
    description:
      "Stay connected around the world. \n\nActivate your eSIM and get online from anywhere with 20% off on Airalo. \n\nAvailable in 200+ countries and regions.",
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
    description:
      "A world of benefits. \n\nYour Visa Signature Exa Card comes with multiple benefits including car rental discounts, travel assistance, and more. \n\nLearn more about all Visa Signature benefits.",
    logo: VisaLogo,
    linkText: "Learn more",
    buttonText: "Go to Visa",
    url: "https://www.visa.com.pr/pague-con-visa/tarjetas/visa-signature.html",
  },
];

export type Benefit = (typeof BENEFITS)[number];

export default function BenefitsSection() {
  const { t } = useTranslation();
  const [selectedBenefit, setSelectedBenefit] = useState<Benefit>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const aspectRatio = useAspectRatio();

  const { width, height } = useWindowDimensions();

  const carouselWidth = Math.max(Platform.OS === "web" ? Math.min(height * aspectRatio, 600) - 64 : width - 64, 250);

  return (
    <>
      <View backgroundColor="$backgroundSoft" padding="$s4" gap="$s3_5">
        <XStack alignItems="center" justifyContent="center" gap="$s2" paddingTop="$s2">
          <Text emphasized headline flex={1}>
            {t("Benefits")}
          </Text>
          {BENEFITS.map((benefit, index) => (
            <View
              key={benefit.id}
              role="tab"
              aria-label={t("{{partner}}, page {{current}} of {{total}}", {
                partner: t(benefit.partner),
                current: index + 1,
                total: BENEFITS.length,
              })}
              aria-selected={index === currentIndex}
              backgroundColor="$interactiveDisabled"
              height="$s2"
              width={index === currentIndex ? "$s5" : "$s2"}
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
            onSnapToItem={(index) => setCurrentIndex(index)}
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
