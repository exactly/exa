import React, { useState } from "react";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { Easing } from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";

import { useTheme, View } from "tamagui";

import BenefitCard from "./BenefitCard";
import BenefitSheet from "./BenefitSheet";
import AiraloLogo from "../../assets/images/airalo.svg";
import AiraloImage from "../../assets/images/airalo.webp";
import ExaLogo from "../../assets/images/exa-logo.svg";
import exaPromo from "../../assets/images/exa-promo.svg";
import PaxLogo from "../../assets/images/pax.svg";
import PaxImage from "../../assets/images/pax.webp";
import VisaLogo from "../../assets/images/visa.svg";
import VisaImage from "../../assets/images/visa.webp";
import { isPromoActive } from "../../utils/promo";
import ThemedSvg from "../shared/ThemedSvg";

function ExaBackground() {
  return (
    <View style={StyleSheet.absoluteFill} backgroundColor="$backgroundBrand">
      <ThemedSvg xml={exaPromo} width="100%" height="100%" preserveAspectRatio="xMaxYMid meet" />
    </View>
  );
}

function RasterBackground({ source }: { source: ComponentProps<typeof Image>["source"] }) {
  const theme = useTheme();
  const brandColor = theme.interactiveBaseBrandDefault.val;
  return (
    <>
      <Image source={source} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={[brandColor, `${brandColor}00`]}
        locations={[0.2444, 0.7542]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </>
  );
}

const BENEFITS = [
  {
    id: "exa",
    partner: "Exa Card",
    title: "Pay Later in 3 at 0% interest",
    logo: ExaLogo,
    Background: ExaBackground,
    linkText: "Choose installments",
  },
  {
    id: "airalo",
    partner: "Airalo",
    title: "20% OFF on eSims",
    descriptions: [
      "Stay connected around the world.",
      "Activate your eSIM and get online from anywhere with 20% off on Airalo.",
      "Available in 200+ countries and regions.",
    ],
    logo: AiraloLogo,
    Background: () => <RasterBackground source={AiraloImage} />,
    url: "https://airalo.pxf.io/c/6807698/3734384/15608?p.code=exaapp",
    termsURL: "https://www.airalo.com/more-info/terms-conditions",
  },
  {
    id: "pax",
    partner: "Pax Assistance",
    title: "Discounts on travel insurance",
    longTitle: "Exclusive discounts on travel insurance",
    descriptions: [
      "Stay safe around the world. Pay with the Exa Card to get exclusive discounts on Pax Assistance's insurance plans.",
    ],
    logo: PaxLogo,
    Background: () => <RasterBackground source={PaxImage} />,
    buttonText: "Go to Pax Assistance",
    url: "https://www.paxassistance.com/exacard",
  },
  {
    id: "visa",
    partner: "Visa",
    title: "Visa Signature benefits",
    longTitle: "Visa Signature Exa Card benefits",
    descriptions: [
      "A world of benefits.",
      "Your Visa Signature Exa Card comes with multiple benefits including car rental discounts, travel assistance, and more.",
      "Learn more about all Visa Signature benefits.",
    ],
    logo: VisaLogo,
    Background: () => <RasterBackground source={VisaImage} />,
    linkText: "Learn more",
    buttonText: "Go to Visa",
    url: "https://help.exactly.app/{language}/articles/11172343-visa-signature-benefits-with-your-exa-card",
  },
];

export type Benefit = (typeof BENEFITS)[number];

const styles = StyleSheet.create({
  overflow: { overflow: "visible" },
});

export default function BenefitsSection({ onExaPress }: { onExaPress?: () => void }) {
  const benefits = isPromoActive() && onExaPress ? BENEFITS : BENEFITS.filter((benefit) => benefit.id !== "exa");
  const [selectedBenefit, setSelectedBenefit] = useState<Benefit>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const [width, setWidth] = useState(0);
  const itemWidth = Math.max(width - 40, 250);

  return (
    <>
      <View
        backgroundColor="$backgroundSoft"
        paddingVertical="$s4_5"
        borderTopWidth={1}
        borderBottomWidth={1}
        borderColor="$borderNeutralSoft"
      >
        <View overflow="hidden" alignItems="center" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {width === 0 ? undefined : (
            <Carousel
              style={styles.overflow}
              containerStyle={styles.overflow}
              width={itemWidth}
              height={160}
              data={benefits}
              autoPlay
              autoPlayInterval={5000}
              withAnimation={{ type: "timing", config: { duration: 512, easing: Easing.bezier(0.7, 0, 0.3, 1) } }}
              onConfigurePanGesture={(gesture) => gesture.activeOffsetX([-10, 10]).failOffsetY([-5, 5])}
              renderItem={({ item }) => (
                <View paddingHorizontal="$s2">
                  <BenefitCard
                    benefit={item}
                    onPress={() => {
                      if (item.id === "exa" && onExaPress) {
                        onExaPress();
                        return;
                      }
                      setSelectedBenefit(item);
                      setSheetOpen(true);
                    }}
                  />
                </View>
              )}
            />
          )}
        </View>
      </View>
      <BenefitSheet benefit={selectedBenefit} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
