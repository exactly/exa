import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, type View as RNView } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  interpolate,
  interpolateColor,
  LinearTransition,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { selectionAsync } from "expo-haptics";

import { CalendarDays } from "@tamagui/lucide-icons-2/icons/CalendarDays";
import { ChevronRight } from "@tamagui/lucide-icons-2/icons/ChevronRight";
import { CreditCard } from "@tamagui/lucide-icons-2/icons/CreditCard";
import { Info } from "@tamagui/lucide-icons-2/icons/Info";
import { Snowflake } from "@tamagui/lucide-icons-2/icons/Snowflake";
import { Wallet } from "@tamagui/lucide-icons-2/icons/Wallet";
import { Zap } from "@tamagui/lucide-icons-2/icons/Zap";
import { toast } from "@tamagui/toast";
import { AnimatePresence, Spinner, Square, useTheme, View, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";

import { BASE_PRODUCT_ID } from "@exactly/common/panda";

import BaseArt from "../../assets/images/card-bg-base.svg";
import DefaultArt from "../../assets/images/card-bg.svg";
import Exa from "../../assets/images/exa.svg";
import { isPromoted } from "../../utils/promo";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { setCardStatus, type CardDetails } from "../../utils/server";
import AnimatedView from "../shared/AnimatedView";
import Switch from "../shared/Switch";
import Text from "../shared/Text";

export default function CardStatus({
  collateral,
  creditLimit,
  spotlightRef,
  mode,
  onCardPress,
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
  onCardPress: () => void;
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
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const {
    mutate: changeCardStatus,
    isPending: isSettingCardStatus,
    variables: optimisticCardStatus,
  } = useMutation({
    mutationKey: ["card", "status"],
    mutationFn: setCardStatus,
    onError: (error) => {
      reportError(error);
      toast.error(t("An error occurred. Please try again later."), { duration: 1000 });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["card", "details"] });
    },
  });
  const frozen = (isSettingCardStatus ? optimisticCardStatus : card?.status) === "FROZEN";
  const Art = card?.productId === BASE_PRODUCT_ID ? BaseArt : DefaultArt;
  return (
    <AnimatedView
      entering={FadeIn}
      exiting={FadeOut}
      layout={LinearTransition}
      backgroundColor="backgroundSoft"
      borderRadius="r3"
      overflow="hidden"
    >
      <XStack padding="s4" justifyContent="space-between" alignItems="center">
        <Text headline emphasized>
          {t("Exa Card pay mode")}
        </Text>
        <Pressable style={styles.learnMore} onPress={onLearnMorePress}>
          <Text footnote brand emphasized>
            {t("Learn more")}
          </Text>
          <ChevronRight size={14} color="interactiveBaseBrandDefault" />
        </Pressable>
      </XStack>
      <YStack paddingHorizontal="s4" paddingTop="s3" gap="s4">
        <Pressable
          onPress={() => {
            selectionAsync().catch(reportError);
            onCardPress();
          }}
        >
          <XStack
            height={96}
            borderRadius="r4"
            overflow="hidden"
            alignItems="center"
            justifyContent="flex-end"
            backgroundColor={card?.productId === BASE_PRODUCT_ID ? "baseBlue" : "cardPreviewBackground"}
          >
            <View position="absolute" top={0} left={0} right={0} bottom={0} alignItems="center" justifyContent="center">
              <Art width="100%" height="100%" preserveAspectRatio="xMidYMid meet" />
            </View>
            <AnimatePresence>
              {frozen ? null : (
                <View
                  key="exa-logo"
                  style={styles.exa}
                  transition={{ preset: "default", properties: "opacity" }}
                  opacity="1 enter:0 exit:0"
                >
                  <Exa width={50} height={20} {...(Platform.OS === "web" ? undefined : { shouldRasterizeIOS: true })} />
                </View>
              )}
            </AnimatePresence>
            <XStack
              hitSlop={15}
              style={styles.details}
              borderRadius="r3"
              paddingVertical="s2"
              paddingHorizontal="s3"
              alignItems="center"
              gap="s2"
              transition={{ preset: "quick", properties: "transform, backgroundColor" }}
              scale="press:0.92"
              backgroundColor="press:rgba(255,255,255,0.15)"
              cursor="pointer"
              zIndex={4}
              onPress={(event) => {
                event.stopPropagation();
                selectionAsync().catch(reportError);
                onDetailsPress();
              }}
            >
              <CreditCard size={14} color="white" />
              <Text footnote emphasized color="white">
                {t("Details")}
              </Text>
            </XStack>
            <AnimatePresence>
              {frozen && (
                <View
                  key="frozen-overlay"
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  backgroundColor="rgba(0,0,0,0.4)"
                  zIndex={2}
                  pointerEvents="none"
                  transition={{ preset: "default", properties: "opacity" }}
                  opacity="1 enter:0 exit:0"
                />
              )}
              {frozen && (
                <View
                  key="frozen-icon"
                  position="absolute"
                  top={0}
                  bottom={0}
                  left="s4"
                  justifyContent="center"
                  zIndex={3}
                  pointerEvents="none"
                  transition={{ preset: "default", properties: "opacity, transform" }}
                  opacity="1 enter:0 exit:0"
                  transform="enter:scale(0.7) exit:scale(0.7)"
                >
                  <Snowflake size={48} strokeWidth={2} color="white" />
                </View>
              )}
            </AnimatePresence>
          </XStack>
        </Pressable>
        {frozen && (
          <AnimatedView entering={FadeIn} exiting={FadeOut}>
            <XStack
              role="switch"
              aria-checked={frozen}
              aria-label={t("Freeze card")}
              aria-disabled={isSettingCardStatus}
              justifyContent="space-between"
              paddingVertical="s4"
              alignItems="center"
              cursor="pointer"
              onPress={() => {
                if (isSettingCardStatus) return;
                selectionAsync().catch(reportError);
                changeCardStatus("ACTIVE");
              }}
            >
              <XStack alignItems="center" gap="s3">
                <Square size={24}>
                  {isSettingCardStatus ? (
                    <Spinner width={24} color="interactiveBaseBrandDefault" alignSelf="flex-start" />
                  ) : (
                    <Snowflake size={24} color="interactiveBaseBrandDefault" />
                  )}
                </Square>
                <Text subHeadline color="uiNeutralPrimary">
                  {t("Freeze card")}
                </Text>
              </XStack>
              <Switch checked={frozen}>
                <Switch.Thumb />
              </Switch>
            </XStack>
          </AnimatedView>
        )}
        {!frozen && (
          <AnimatedView entering={FadeIn} exiting={FadeOut}>
            <PayModeToggle
              spotlightRef={spotlightRef}
              mode={mode}
              onInstallmentsPress={onInstallmentsPress}
              onModeChange={onModeChange}
            />
          </AnimatedView>
        )}
      </YStack>
      {!frozen && (
        <AnimatedView entering={FadeIn} exiting={FadeOut}>
          <LimitPaginator
            collateral={collateral}
            creditLimit={creditLimit}
            mode={mode}
            onCreditLimitInfoPress={onCreditLimitInfoPress}
            onSpendingLimitInfoPress={onSpendingLimitInfoPress}
            spendingLimit={spendingLimit}
          />
        </AnimatedView>
      )}
    </AnimatedView>
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
  const [borderColor, setBorderColor] = useState(
    isDebit ? theme.cardDebitInteractive.val : theme.cardCreditInteractive.val,
  );
  useEffect(() => {
    progress.value = withTiming(isDebit ? 0 : 1, { duration: 512, easing: Easing.bezier(0.7, 0, 0.3, 1) });
  }, [isDebit, progress]);
  /* istanbul ignore next */
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      progress.value,
      [0, 1],
      [theme.cardDebitInteractive.val, theme.cardCreditInteractive.val],
    ),
    transform: [{ translateX: interpolate(progress.value, [0, 1], [0, width / 2]) }],
  }));
  /* istanbul ignore next */
  useAnimatedReaction(
    () => progress.value,
    (value) => {
      scheduleOnRN(setNowColor, interpolateColor(value, [0, 1], [theme.cardDebitText.val, neutral]));
      scheduleOnRN(setLaterColor, interpolateColor(value, [0, 1], [neutral, theme.cardCreditText.val]));
      scheduleOnRN(
        setBorderColor,
        interpolateColor(value, [0, 1], [theme.cardDebitInteractive.val, theme.cardCreditInteractive.val]),
      );
    },
    [
      theme.cardDebitText.val,
      theme.cardCreditText.val,
      theme.cardDebitInteractive.val,
      theme.cardCreditInteractive.val,
      theme.cardDebitBorder.val,
      theme.cardCreditBorder.val,
      neutral,
    ],
  );
  const promoted = mode > 0 && isPromoted(mode);
  return (
    <YStack>
      <XStack
        borderRadius="r_0"
        borderWidth={1}
        height={48}
        style={{ borderColor }}
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
        }}
      >
        <Animated.View style={[styles.pill, { width: Math.max(0, width / 2 - 6) }, pillStyle]} />
        <Pressable
          style={styles.segment}
          onPress={() => {
            if (isDebit) return;
            selectionAsync().catch(reportError);
            onModeChange(0);
          }}
        >
          <XStack alignItems="center" justifyContent="center" gap="s2" flex={1}>
            <Zap size={16} color={nowColor} />
            <Text headline emphasized style={{ color: nowColor }} maxFontSizeMultiplier={1}>
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
          <XStack alignItems="center" justifyContent="center" gap="s2" flex={1}>
            <CalendarDays size={16} color={laterColor} />
            <Text headline emphasized style={{ color: laterColor }} maxFontSizeMultiplier={1}>
              {t("Later in {{count}}", { count: mode > 0 ? mode : (lastInstallments ?? 1) })}
            </Text>
          </XStack>
        </Pressable>
      </XStack>
      <AnimatePresence>
        {promoted && (
          <XStack
            key="promo-badge"
            marginTop={-10}
            transition={{ preset: "default", properties: "opacity" }}
            opacity="1 enter:0 exit:0"
          >
            <View flex={1} />
            <View flex={1} alignItems="center">
              <XStack
                backgroundColor="interactiveBaseSuccessDefault"
                minHeight={20}
                borderRadius="r2"
                alignItems="center"
                justifyContent="center"
                paddingHorizontal="s2"
              >
                <Text
                  color="interactiveOnBaseSuccessDefault"
                  textTransform="uppercase"
                  textAlign="center"
                  caption2
                  emphasized
                >
                  {t("0% interest")}
                </Text>
              </XStack>
            </View>
          </XStack>
        )}
      </AnimatePresence>
    </YStack>
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
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const [width, setWidth] = useState(0);
  const spending = (Number(spendingLimit) / 1e6).toLocaleString(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const credit = (Number(creditLimit) / 1e6).toLocaleString(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <View
      height={48}
      overflow="hidden"
      marginVertical="s4"
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 && (
        <XStack width={width * 2} x={mode > 0 ? -width : 0} transition={{ preset: "default", properties: "transform" }}>
          <XStack
            width={width}
            height={48}
            alignItems="center"
            gap="s3"
            paddingHorizontal="s4"
            hitSlop={15}
            onPress={onSpendingLimitInfoPress}
            aria-label={t("Spending limit info")}
          >
            <Wallet size={20} color="uiNeutralSecondary" />
            <XStack flex={1} alignItems="center" gap="s2">
              <Text callout emphasized>
                {t("Spending limit")}
              </Text>
              <Info size={16} color="uiInfoSecondary" />
            </XStack>
            <Text title3 aria-label={hidden ? "***" : `$${spending}`}>
              <Text aria-hidden secondary>
                $
              </Text>
              <Text aria-hidden sensitive emphasized>
                {spending}
              </Text>
            </Text>
          </XStack>
          <XStack
            width={width}
            height={48}
            alignItems="center"
            gap="s3"
            paddingHorizontal="s4"
            hitSlop={15}
            onPress={onCreditLimitInfoPress}
            aria-label={t("Credit limit info")}
          >
            <CreditCard size={20} color="uiNeutralSecondary" />
            <YStack flex={1} justifyContent="center">
              <XStack alignItems="center" gap="s2">
                <Text callout emphasized>
                  {t("Credit limit")}
                </Text>
                <Info size={16} color="uiInfoSecondary" />
              </XStack>
              <Text sensitive footnote secondary>
                {t("Collateral {{value}}", {
                  value: `$${(Number(collateral) / 1e18).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                })}
              </Text>
            </YStack>
            <Text title3 aria-label={hidden ? "***" : `$${credit}`}>
              <Text aria-hidden secondary>
                $
              </Text>
              <Text aria-hidden sensitive emphasized>
                {credit}
              </Text>
            </Text>
          </XStack>
        </XStack>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  details: { position: "absolute", top: 8, right: 8 },
  exa: { position: "absolute", top: 12, left: 16 },
  learnMore: { flexDirection: "row", alignItems: "center", gap: 4 },
  pill: { position: "absolute", top: 2, bottom: 2, left: 2, right: 2, borderRadius: 9999 },
  segment: { flex: 1, justifyContent: "center", alignItems: "center" },
});
