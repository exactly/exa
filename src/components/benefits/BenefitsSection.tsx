import React, { useState } from "react";
import type { ComponentProps } from "react";
import { StyleSheet } from "react-native";
import { Easing } from "react-native-reanimated";
import Carousel from "react-native-reanimated-carousel";

import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

import { useTheme, View } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import domain from "@exactly/common/domain";
import { isBase } from "@exactly/common/generated/chain";
import { BASE_PRODUCT_ID } from "@exactly/common/panda";

import BenefitCard from "./BenefitCard";
import BenefitSheet from "./BenefitSheet";
import AiraloLogo from "../../assets/images/airalo.svg";
import AiraloImage from "../../assets/images/airalo.webp";
import ExaLogo from "../../assets/images/exa-logo.svg";
import exaPromo from "../../assets/images/exa-promo.svg";
import PaxLogo from "../../assets/images/pax.svg";
import PaxImage from "../../assets/images/pax.webp";
import TokenizedStocksImage from "../../assets/images/tokenized-stocks.webp";
import BankAccountImage from "../../assets/images/us-eu-bank-account.webp";
import VisaBaseImage from "../../assets/images/visa-base.webp";
import VisaLogo from "../../assets/images/visa.svg";
import VisaImage from "../../assets/images/visa.webp";
import { isPromoActive } from "../../utils/promo";
import { getRampProviders } from "../../utils/server";
import useKYC from "../../utils/useKYC";
import Image from "../shared/Image";
import Skeleton from "../shared/Skeleton";
import ThemedSvg from "../shared/ThemedSvg";

import type { CardDetails } from "../../utils/server";

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

function IllustrationBackground({ source }: { source: ComponentProps<typeof Image>["source"] }) {
  return (
    <View style={StyleSheet.absoluteFill} backgroundColor="$uiBrandSecondary">
      <Image source={source} position="absolute" top="$s3_5" right="$s3_5" width={136} height={136} />
    </View>
  );
}

const BENEFITS = [
  {
    id: "exa" as const,
    partner: "Exa Card",
    title: "Pay Later in 3 at 0% interest",
    logo: ExaLogo,
    Background: ExaBackground,
    linkText: "Choose installments",
  },
  {
    id: "accounts" as const,
    partner: "Virtual bank accounts",
    title: "Send and receive USD and EUR",
    logo: ExaLogo,
    Background: () => <IllustrationBackground source={BankAccountImage} />,
    linkText: "Create account",
  },
  {
    id: "stocks" as const,
    partner: "Stocks",
    title: "Tokenized stocks are here!",
    logo: ExaLogo,
    Background: () => <IllustrationBackground source={TokenizedStocksImage} />,
    linkText: "Start investing",
  },
  {
    id: "pax" as const,
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
    external: true,
  },
  {
    id: "airalo" as const,
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
    id: "visa" as const,
    partner: "Visa",
    title: "Visa Signature benefits",
    longTitle: "Visa Signature Exa Card benefits",
    descriptions: [
      "A world of benefits.",
      "Your Visa Signature Exa Card comes with multiple benefits including car rental discounts, travel assistance, and more.",
      "Learn more about all Visa Signature benefits.",
    ],
    logo: VisaLogo,
    Background: () => (
      <RasterBackground
        source={
          useQuery<CardDetails>({ queryKey: ["card", "details"] }).data?.productId === BASE_PRODUCT_ID
            ? VisaBaseImage
            : VisaImage
        }
      />
    ),
    linkText: "Learn more",
    buttonText: "Go to Visa",
    url: "https://help.exactly.app/{language}/articles/11172343-visa-signature-benefits-with-your-exa-card",
  },
];

export type Benefit = (typeof BENEFITS)[number];

const styles = StyleSheet.create({
  overflow: { overflow: "visible" },
});

export default function BenefitsSection({
  onExaPress,
  onStocksPress,
}: {
  onExaPress?: () => void;
  onStocksPress?: () => void;
}) {
  const router = useRouter();
  const { approved: isKYCApproved } = useKYC();
  const { data: country } = useQuery<string>({ queryKey: ["user", "country"] });
  const redirectURL = `https://${domain}/add-funds`;
  const { data: providers, isLoading } = useQuery({
    queryKey: ["ramp", "providers", country, redirectURL],
    queryFn: () => getRampProviders(country, redirectURL),
    enabled: !!country && !isBase,
    staleTime: Infinity,
  });
  const bridge = providers?.bridge.status;
  const benefits = BENEFITS.filter(({ id }) => {
    switch (id) {
      case "exa":
        return isKYCApproved && isPromoActive() && !!onExaPress;
      case "accounts":
        return !!providers?.bridge.onramp.currencies.some((item) => typeof item === "string");
      case "airalo":
        return isKYCApproved && bridge !== "NOT_STARTED" && bridge !== "ONBOARDING";
      case "stocks":
        return !!onStocksPress;
      default:
        return isKYCApproved;
    }
  }).map((benefit) =>
    benefit.id === "accounts" && bridge === "ACTIVE" ? { ...benefit, linkText: "View accounts" } : benefit,
  );
  const [selectedBenefit, setSelectedBenefit] = useState<Benefit>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const [width, setWidth] = useState(0);
  const itemWidth = Math.max(width - 40, 250);

  if (!isLoading && benefits.length === 0) return null;
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
          {width === 0 ? undefined : isLoading ? (
            <Skeleton width={itemWidth - 8} height={160} radius={12} />
          ) : (
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
                  <BenefitCard benefit={item} onPress={() => open(item)} />
                </View>
              )}
            />
          )}
        </View>
      </View>
      <BenefitSheet benefit={selectedBenefit} open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );

  function open(benefit: Benefit) {
    switch (benefit.id) {
      case "exa":
        onExaPress?.();
        return;
      case "accounts":
        router.push(isKYCApproved ? { pathname: "/add-funds", params: { type: "fiat" } } : "/add-funds/welcome");
        return;
      case "stocks":
        onStocksPress?.();
        return;
    }
    setSelectedBenefit(benefit);
    setSheetOpen(true);
  }
}
