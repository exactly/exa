import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, type View as RNView } from "react-native";
import { Easing, interpolateColor, useAnimatedReaction, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { selectionAsync } from "expo-haptics";

import { CalendarDays, ChevronRight, CreditCard, Info, Wallet, Zap } from "@tamagui/lucide-icons";
import { useTheme, View, XStack, YStack } from "tamagui";

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
  collateral: bigint;
  creditLimit: bigint;
  mode: number;
  onCreditLimitInfoPress: () => void;
  onDetailsPress: () => void;
  onInstallmentsPress: () => void;
  onLearnMorePress: () => void;
  onModeChange: (mode: number) => void;
  onSpendingLimitInfoPress: () => void;
  spendingLimit: bigint;
  spotlightRef?: React.RefObject<null | RNView>;
}) {
  const { t } = useTranslation();
  return (
    <YStack
      key="card-status"
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
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
  const theme = useTheme();
  const { data: lastInstallments } = useQuery<number>({ queryKey: ["settings", "installments"] });
  const isDebit = mode === 0;
  const [width, setWidth] = useState(0);
  const neutral = theme.uiNeutralSecondary.val;
  const progress = useSharedValue(isDebit ? 0 : 1);
  const [nowColor, setNowColor] = useState(isDebit ? theme.cardDebitText.val : neutral);
  const [laterColor, setLaterColor] = useState(isDebit ? neutral : theme.cardCreditText.val);
  useEffect(() => {
    progress.value = withTiming(isDebit ? 0 : 1, { duration: 512, easing: Easing.bezier(0.7, 0, 0.3, 1) });
  }, [isDebit, progress]);
  /* istanbul ignore next */
  useAnimatedReaction(
    () => progress.value,
    (value) => {
      scheduleOnRN(setNowColor, interpolateColor(value, [0, 1], [theme.cardDebitText.val, neutral]));
      scheduleOnRN(setLaterColor, interpolateColor(value, [0, 1], [neutral, theme.cardCreditText.val]));
    },
  );
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
          <Zap size={16} color={nowColor} />
          <Text footnote emphasized style={{ color: nowColor }} maxFontSizeMultiplier={1}>
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
          <CalendarDays size={16} color={laterColor} />
          <Text footnote emphasized style={{ color: laterColor }} maxFontSizeMultiplier={1}>
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
  collateral: bigint;
  creditLimit: bigint;
  mode: number;
  onCreditLimitInfoPress: () => void;
  onSpendingLimitInfoPress: () => void;
  spendingLimit: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
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
          <Amount
            label={`$${(Number(spendingLimit) / 1e6).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            alignItems="center"
          >
            <Text aria-hidden title3 secondary>
              $
            </Text>
            <Text sensitive aria-hidden title3 emphasized>
              {(Number(spendingLimit) / 1e6).toLocaleString(language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
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
            <Text sensitive footnote secondary>
              {t("Collateral {{value}}", {
                value: `$${(Number(collateral) / 1e18).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              })}
            </Text>
          </YStack>
          <Amount
            label={`$${(Number(creditLimit) / 1e6).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            alignItems="center"
          >
            <Text aria-hidden title3 secondary>
              $
            </Text>
            <Text sensitive aria-hidden title3 emphasized>
              {(Number(creditLimit) / 1e6).toLocaleString(language, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
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
