import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, type View as RNView } from "react-native";

import { selectionAsync } from "expo-haptics";

import { CalendarDays, ChevronRight, CreditCard, Info, Wallet, Zap } from "@tamagui/lucide-icons";
import { View, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import CardBg from "../../assets/images/card-bg.svg";
import Exa from "../../assets/images/exa.svg";
import reportError from "../../utils/reportError";
import Amount from "../shared/Amount";
import Text from "../shared/Text";

export default function CardStatus({
  collateral,
  creditLimit,
  spotlightRef,
  mode,
  onCreditLimitInfoPress,
  onDetailsPress,
  onInstallmentsPress,
  onLearnMorePress,
  onModeChange,
  onSpendingLimitInfoPress,
  spendingLimit,
}: {
  collateral: string;
  creditLimit: string;
  mode: number;
  onCreditLimitInfoPress: () => void;
  onDetailsPress: () => void;
  onInstallmentsPress: () => void;
  onLearnMorePress: () => void;
  onModeChange: (mode: number) => void;
  onSpendingLimitInfoPress: () => void;
  spendingLimit: string;
  spotlightRef?: React.RefObject<null | RNView>;
}) {
  const { t } = useTranslation();
  return (
    <YStack
      key="card-status"
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      shadowColor="$uiNeutralSecondary"
      shadowOffset={{ width: 0, height: 2 }}
      shadowOpacity={0.15}
      shadowRadius={8}
      overflow="hidden"
      opacity={1}
      transform={[{ translateY: 0 }]}
      animation="default"
      animateOnly={["opacity", "transform"]}
      enterStyle={{ opacity: 0, transform: [{ translateY: -20 }] }}
      exitStyle={{ opacity: 0, transform: [{ translateY: -20 }] }}
    >
      <XStack padding="$s4" justifyContent="space-between" alignItems="center">
        <Text headline emphasized>
          {t("Exa Card pay mode")}
        </Text>
        <Pressable style={styles.learnMore} onPress={onLearnMorePress}>
          <Text footnote brand emphasized>
            {t("Learn more")}
          </Text>
          <ChevronRight size={14} color="$interactiveBaseBrandDefault" />
        </Pressable>
      </XStack>
      <YStack paddingHorizontal="$s4" paddingBottom="$s4" paddingTop="$s3" gap="$s4">
        <XStack
          height={96}
          borderRadius="$r4"
          overflow="hidden"
          alignItems="center"
          justifyContent="flex-end"
          backgroundColor="#1A181A"
        >
          <View position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
            <CardBg width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />
          </View>
          <Exa
            width={50}
            height={20}
            style={styles.exa}
            {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })}
          />
          <Pressable
            style={styles.details}
            onPress={() => {
              selectionAsync().catch(reportError);
              onDetailsPress();
            }}
            hitSlop={8}
          >
            {({ pressed, hovered }) => (
              <XStack
                borderRadius="$r3"
                paddingVertical="$s2"
                paddingHorizontal="$s3"
                alignItems="center"
                gap="$s2"
                cursor="pointer"
                backgroundColor={pressed ? "rgba(255,255,255,0.2)" : hovered ? "rgba(255,255,255,0.12)" : "transparent"}
                scale={pressed ? 0.97 : 1}
                animation="quick"
                animateOnly={["transform"]}
              >
                <CreditCard size={14} color="white" />
                <Text footnote emphasized color="white">
                  {t("Details")}
                </Text>
              </XStack>
            )}
          </Pressable>
        </XStack>
        <PayModeToggle
          spotlightRef={spotlightRef}
          mode={mode}
          onInstallmentsPress={onInstallmentsPress}
          onModeChange={onModeChange}
        />
        <LimitPaginator
          collateral={collateral}
          creditLimit={creditLimit}
          mode={mode}
          onCreditLimitInfoPress={onCreditLimitInfoPress}
          onSpendingLimitInfoPress={onSpendingLimitInfoPress}
          spendingLimit={spendingLimit}
        />
      </YStack>
    </YStack>
  );
}

function PayModeToggle({
  spotlightRef,
  mode,
  onInstallmentsPress,
  onModeChange,
}: {
  mode: number;
  onInstallmentsPress: () => void;
  onModeChange: (mode: number) => void;
  spotlightRef?: React.RefObject<null | RNView>;
}) {
  const { t } = useTranslation();
  const { data: lastInstallments } = useQuery<number>({ queryKey: ["settings", "installments"] });
  const isDebit = mode === 0;
  const [width, setWidth] = useState(0);
  return (
    <XStack
      borderRadius="$r_0"
      borderWidth={1}
      borderColor={isDebit ? "$cardDebitBorder" : "$cardCreditBorder"}
      height={44}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
    >
      <View
        position="absolute"
        top={2}
        bottom={2}
        left={2}
        right={2}
        width={Math.max(0, width / 2 - 6)}
        borderRadius="$r_0"
        backgroundColor={isDebit ? "$cardDebitInteractive" : "$cardCreditInteractive"}
        x={isDebit ? 0 : width / 2}
        animation="default"
        animateOnly={["transform"]}
      />
      <Pressable
        style={styles.segment}
        onPress={() => {
          if (isDebit) return;
          selectionAsync().catch(reportError);
          onModeChange(0);
        }}
      >
        <XStack alignItems="center" justifyContent="center" gap="$s2" flex={1}>
          <Zap size={16} color={isDebit ? "$cardDebitText" : "$uiNeutralSecondary"} />
          <Text
            footnote
            emphasized
            color={isDebit ? "$cardDebitText" : "$uiNeutralSecondary"}
            maxFontSizeMultiplier={1}
          >
            {t("Now")}
          </Text>
        </XStack>
      </Pressable>
      <Pressable
        ref={spotlightRef}
        style={styles.segment}
        onPress={() => {
          selectionAsync().catch(reportError);
          if (mode > 0) onInstallmentsPress();
          else onModeChange(lastInstallments ?? 1);
        }}
      >
        <XStack alignItems="center" justifyContent="center" gap="$s2" flex={1}>
          <CalendarDays size={16} color={isDebit ? "$uiNeutralSecondary" : "$cardCreditText"} />
          <Text
            footnote
            emphasized
            color={isDebit ? "$uiNeutralSecondary" : "$cardCreditText"}
            maxFontSizeMultiplier={1}
          >
            {t("Later in {{count}}", { count: mode > 0 ? mode : (lastInstallments ?? 1) })}
          </Text>
        </XStack>
      </Pressable>
    </XStack>
  );
}

function LimitPaginator({
  collateral,
  creditLimit,
  mode,
  onCreditLimitInfoPress,
  onSpendingLimitInfoPress,
  spendingLimit,
}: {
  collateral: string;
  creditLimit: string;
  mode: number;
  onCreditLimitInfoPress: () => void;
  onSpendingLimitInfoPress: () => void;
  spendingLimit: string;
}) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  return (
    <View height={48} overflow="hidden" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <XStack width={width * 2} x={mode > 0 ? -width : 0} animation="default" animateOnly={["transform"]}>
        <XStack width={width} height={48} alignItems="center" gap="$s3">
          <Wallet size={20} color="$uiNeutralSecondary" />
          <XStack flex={1} alignItems="center" gap="$s2">
            <Text callout emphasized>
              {t("Spending limit")}
            </Text>
            <Pressable hitSlop={15} onPress={onSpendingLimitInfoPress} aria-label={t("Spending limit info")}>
              <Info size={16} color="$interactiveBaseBrandDefault" />
            </Pressable>
          </XStack>
          <Amount label={spendingLimit} alignItems="center">
            <Text aria-hidden title3 secondary>
              $
            </Text>
            <Text sensitive aria-hidden title3 emphasized>
              {spendingLimit.replace("$", "")}
            </Text>
          </Amount>
        </XStack>
        <XStack width={width} height={48} alignItems="center" gap="$s3">
          <CreditCard size={20} color="$uiNeutralSecondary" />
          <YStack flex={1} justifyContent="center">
            <XStack alignItems="center" gap="$s2">
              <Text callout emphasized>
                {t("Credit limit")}
              </Text>
              <Pressable hitSlop={15} onPress={onCreditLimitInfoPress} aria-label={t("Credit limit info")}>
                <Info size={16} color="$interactiveBaseBrandDefault" />
              </Pressable>
            </XStack>
            <Text footnote secondary>
              {t("Collateral {{value}}", { value: collateral })}
            </Text>
          </YStack>
          <Amount label={creditLimit} alignItems="center">
            <Text aria-hidden title3 secondary>
              $
            </Text>
            <Text sensitive aria-hidden title3 emphasized>
              {creditLimit.replace("$", "")}
            </Text>
          </Amount>
        </XStack>
      </XStack>
    </View>
  );
}

const styles = StyleSheet.create({
  details: { position: "absolute", top: 8, right: 8 },
  exa: { position: "absolute", top: 12, left: 16 },
  learnMore: { flexDirection: "row", alignItems: "center", gap: 4 },
  segment: { flex: 1, justifyContent: "center", alignItems: "center" },
});
