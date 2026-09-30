import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AccessibilityInfo, Platform, Pressable, type AccessibilityActionEvent } from "react-native";
import { Carousel, type CarouselRef } from "react-native-reanimated-carousel";

import { impactAsync, ImpactFeedbackStyle } from "expo-haptics";
import { useRouter } from "expo-router";

import { Info, X } from "@tamagui/lucide-icons-2";
import { View, VisuallyHidden, XStack, YStack } from "tamagui";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import { presentArticle } from "../../utils/intercom";
import { getPromoMonths, isPromoActive, isPromoted } from "../../utils/promo";
import reportError from "../../utils/reportError";
import useInstallmentRates from "../../utils/useInstallmentRates";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function InstallmentsSheet({
  mode,
  onClose,
  onModeChange,
  open,
}: {
  mode: number;
  onClose: () => void;
  onModeChange: (mode: number) => void;
  open: boolean;
}) {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { promoEnd, refund } = getPromoMonths(language);
  const [selected, setSelected] = useState(mode > 0 ? mode : 1);
  const [page, setPage] = useState<number>();
  useEffect(() => {
    if (open) {
      setSelected(mode > 0 ? mode : 1); // eslint-disable-line @eslint-react/set-state-in-effect
      setPage(undefined); // eslint-disable-line @eslint-react/set-state-in-effect
    }
  }, [mode, open]);
  const carouselRef = useRef<CarouselRef>(null);
  const id = useId();
  const rates = useInstallmentRates();
  const [width, setWidth] = useState(0);
  const handleLayout = useCallback((event: { nativeEvent: { layout: { width: number } } }) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);
  const perPage = Math.max(1, Math.floor((width - 2 * PADDING + GAP) / (CARD_SIZE + GAP)));
  const pageWidth = perPage * (CARD_SIZE + GAP);
  const pages: number[][] = [];
  for (let index = 0; index < INSTALLMENTS.length; index += perPage) {
    pages.push(INSTALLMENTS.slice(index, index + perPage));
  }
  const current = page ?? Math.floor((Math.max(mode, 1) - 1) / perPage);
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <SafeView paddingTop={0} borderTopLeftRadius="$r4" borderTopRightRadius="$r4" backgroundColor="$backgroundSoft">
        <YStack gap="$s5" paddingVertical="$s5">
          <YStack gap="$s5">
            <YStack gap="$s4" paddingHorizontal="$s5">
              <XStack justifyContent="space-between" alignItems="center" gap="$s3">
                <Text emphasized headline flex={1}>
                  {t("Set installments")}
                </Text>
                <IconButton icon={X} aria-label={t("Close")} onPress={onClose} />
              </XStack>
              <Text subHeadline secondary>
                {t(
                  "Choose how many installments to use for future card purchases. You can always change this before each purchase.",
                )}
              </Text>
              {isPromoActive() && (
                <YStack
                  backgroundColor="$interactiveBaseSuccessDefault"
                  borderRadius="$r3"
                  padding="$s4"
                  gap="$s1"
                  alignItems="center"
                >
                  <XStack alignItems="center" gap="$s2">
                    <Text emphasized subHeadline color="$interactiveOnBaseSuccessDefault">
                      {t("*0% interest promo through {{month}}", { month: promoEnd })}
                    </Text>
                    <IconButton
                      icon={Info}
                      size={16}
                      color="$interactiveOnBaseSuccessDefault"
                      aria-label={t("More info")}
                      onPress={() => {
                        presentArticle("14424639").catch(reportError);
                      }}
                    />
                  </XStack>
                  <Text caption2 color="$interactiveOnBaseSuccessDefault">
                    {t("Applies only for 1, 2, or 3 installments. Interest is reimbursed in early {{month}}.", {
                      month: refund,
                    })}
                  </Text>
                </YStack>
              )}
            </YStack>
            <View
              overflow="hidden"
              onLayout={handleLayout}
              role="group"
              aria-label={t("Set installments")}
              tabIndex={0}
              aria-describedby={Platform.OS === "web" ? id : undefined}
              onKeyDown={(event) => {
                if (!("key" in event) || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                event.preventDefault();
                if (typeof event.currentTarget !== "number") event.currentTarget.focus();
                if (event.key === "ArrowLeft" && current > 0) carouselRef.current?.prev();
                else if (event.key === "ArrowRight" && current < pages.length - 1) carouselRef.current?.next();
              }}
              aria-live={Platform.OS === "web" ? "polite" : undefined}
              aria-atomic={false}
            >
              {Platform.OS === "web" && (
                <VisuallyHidden id={id}>
                  {t("Use the arrow keys to browse. Press Tab to focus an option, then Enter to select it.")}
                </VisuallyHidden>
              )}
              {width === 0 ? undefined : (
                <Carousel
                  ref={carouselRef}
                  itemSize={pageWidth}
                  style={{ width: width - PADDING - GAP, height: CARD_SIZE, marginLeft: PADDING, overflow: "visible" }}
                  data={pages}
                  defaultIndex={Math.floor((Math.max(mode, 1) - 1) / perPage)}
                  onSnapToItem={(next) => {
                    setPage(next);
                    if (Platform.OS !== "web" && next !== current)
                      AccessibilityInfo.announceForAccessibility(
                        pages[next]?.map((count) => t("{{count}} installments", { count })).join(", ") ?? "",
                      );
                  }}
                  loop={false}
                  overscrollEnabled={false}
                  renderItem={({ item: options, index }) => (
                    <XStack gap={GAP}>
                      {options.map((installment) => {
                        const isSelected = selected === installment;
                        const entry = rates?.installments[installment - 1];
                        const label =
                          entry?.payments === undefined
                            ? null
                            : t("{{rate}} APR", {
                                rate: (Number(entry.rate) / 1e18).toLocaleString(language, {
                                  style: "percent",
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }),
                              });
                        const promoted = isPromoted(installment) && label !== null;
                        const accentColor = promoted ? "$interactiveBaseSuccessDefault" : "$cardCreditInteractive";
                        return (
                          <YStack
                            key={installment}
                            role="button"
                            accessible={Platform.OS === "web" ? undefined : true}
                            aria-label={`${t("{{count}} installments", { count: installment })}, ${promoted ? t("0% APR*") : (label ?? t(rates ? "N/A" : "Loading..."))}`}
                            {...(Platform.OS === "web"
                              ? { "aria-pressed": isSelected }
                              : { accessibilityState: { selected: isSelected } })}
                            tabIndex={index === current ? 0 : -1}
                            {...(Platform.OS === "web"
                              ? {}
                              : {
                                  accessibilityActions: [
                                    { name: "activate" },
                                    ...(current > 0
                                      ? [{ name: "previous", label: t("Previous installment options") }]
                                      : []),
                                    ...(current < pages.length - 1
                                      ? [{ name: "next", label: t("Next installment options") }]
                                      : []),
                                  ],
                                  onAccessibilityAction: ({
                                    nativeEvent: { actionName },
                                  }: AccessibilityActionEvent) => {
                                    if (actionName === "activate") select(installment);
                                    else if (actionName === "previous" && current > 0) carouselRef.current?.prev();
                                    else if (actionName === "next" && current < pages.length - 1)
                                      carouselRef.current?.next();
                                  },
                                })}
                            padding={0}
                            focusVisibleStyle={{
                              outlineStyle: "solid",
                              outlineWidth: 2,
                              outlineColor: "$borderBrandStrong",
                              outlineOffset: -3,
                            }}
                            width={CARD_SIZE}
                            height={CARD_SIZE}
                            borderRadius="$r3"
                            alignItems="center"
                            justifyContent="center"
                            gap="$s3_5"
                            backgroundColor={isSelected ? accentColor : "transparent"}
                            borderWidth={1}
                            borderColor={isSelected || promoted ? accentColor : "$cardCreditBorder"}
                            transition="quick"
                            animateOnly={["transform"]}
                            pressStyle={{ scale: 0.96 }}
                            cursor="pointer"
                            onMouseDown={(event) => event.preventDefault()}
                            onPress={() => select(installment)}
                            onKeyDown={(event) => {
                              if (!("key" in event) || (event.key !== "Enter" && event.key !== " ")) return;
                              event.preventDefault();
                              if (event.key === "Enter") select(installment);
                            }}
                            onKeyUp={(event) => {
                              if (!("key" in event) || event.key !== " ") return;
                              event.preventDefault();
                              select(installment);
                            }}
                          >
                            <Text title2 emphasized color={isSelected ? "$cardCreditText" : accentColor}>
                              {installment}
                            </Text>
                            {promoted ? (
                              <YStack alignItems="center" gap="$s1">
                                <Text
                                  caption2
                                  emphasized
                                  color={isSelected ? "$cardCreditText" : accentColor}
                                  numberOfLines={1}
                                >
                                  {t("0% APR*")}
                                </Text>
                                <Text
                                  caption2
                                  color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"}
                                  numberOfLines={1}
                                  textDecorationLine="line-through"
                                  opacity={0.6}
                                >
                                  {label}
                                </Text>
                              </YStack>
                            ) : rates ? (
                              <Text
                                caption2
                                color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"}
                                numberOfLines={1}
                              >
                                {label ?? t("N/A")}
                              </Text>
                            ) : (
                              <Skeleton height={12} width={48} />
                            )}
                          </YStack>
                        );
                      })}
                    </XStack>
                  )}
                />
              )}
            </View>
          </YStack>
          <Pressable
            hitSlop={15}
            onPress={() => {
              onClose();
              router.push("/calculator");
            }}
          >
            <Text footnote emphasized brand textAlign="center" paddingHorizontal="$s4">
              {t("Installments calculator")}
            </Text>
          </Pressable>
        </YStack>
      </SafeView>
    </ModalSheet>
  );

  function select(installment: number) {
    if (installment < 1 || installment > MAX_INSTALLMENTS) return;
    setSelected(installment);
    if (installment !== mode) onModeChange(installment);
    impactAsync(ImpactFeedbackStyle.Medium).catch(reportError);
    const target = Math.floor((installment - 1) / perPage);
    if (target !== current)
      requestAnimationFrame(() => carouselRef.current?.scrollTo({ index: target, animated: true }));
  }
}

const CARD_SIZE = 104;
const GAP = 8;
const PADDING = 16;
const INSTALLMENTS = Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1);
