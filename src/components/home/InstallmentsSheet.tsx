import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import Carousel, { type ICarouselInstance } from "react-native-reanimated-carousel";

import { impactAsync, ImpactFeedbackStyle } from "expo-haptics";
import { useRouter } from "expo-router";

import { Info, X } from "@tamagui/lucide-icons";
import { View, XStack, YStack } from "tamagui";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import { presentArticle } from "../../utils/intercom";
import { isPromoActive, isPromoted } from "../../utils/promo";
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
  const [selected, setSelected] = useState(mode > 0 ? mode : 1);
  useEffect(() => {
    if (open) setSelected(mode > 0 ? mode : 1); // eslint-disable-line @eslint-react/set-state-in-effect
  }, [mode, open]);
  const carouselRef = useRef<ICarouselInstance>(null);
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
                      {t("*0% interest promo through May")}
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
                    {t("Interest is reimbursed in early June")}
                  </Text>
                </YStack>
              )}
            </YStack>
            <View overflow="hidden" onLayout={handleLayout}>
              {width === 0 ? undefined : (
                <Carousel
                  ref={carouselRef}
                  width={pageWidth}
                  height={CARD_SIZE}
                  style={{ width: width - PADDING - GAP, marginLeft: PADDING, overflow: "visible" }}
                  data={pages}
                  defaultIndex={Math.floor((Math.max(mode, 1) - 1) / perPage)}
                  loop={false}
                  overscrollEnabled={false}
                  renderItem={({ item: page }) => (
                    <XStack gap={GAP}>
                      {page.map((installment) => {
                        const isSelected = selected === installment;
                        const entry = rates?.installments[installment - 1];
                        const rateLabel =
                          entry?.payments === undefined
                            ? null
                            : t("{{rate}} APR", {
                                rate: (Number(entry.rate) / 1e18).toLocaleString(language, {
                                  style: "percent",
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                }),
                              });
                        const promoted = isPromoted(installment) && rateLabel !== null;
                        const accentColor = promoted ? "$interactiveBaseSuccessDefault" : "$cardCreditInteractive";
                        return (
                          <YStack
                            key={installment}
                            width={CARD_SIZE}
                            height={CARD_SIZE}
                            borderRadius="$r3"
                            alignItems="center"
                            justifyContent="center"
                            gap="$s3_5"
                            backgroundColor={isSelected ? accentColor : "transparent"}
                            borderWidth={1}
                            borderColor={isSelected || promoted ? accentColor : "$cardCreditBorder"}
                            animation="quick"
                            animateOnly={["transform"]}
                            pressStyle={{ scale: 0.96 }}
                            cursor="pointer"
                            onPress={() => {
                              setSelected(installment);
                              if (installment !== mode) onModeChange(installment);
                              impactAsync(ImpactFeedbackStyle.Medium).catch(reportError);
                              const target = Math.floor((installment - 1) / perPage);
                              if (target !== carouselRef.current?.getCurrentIndex()) {
                                requestAnimationFrame(() =>
                                  carouselRef.current?.scrollTo({ index: target, animated: true }),
                                );
                              }
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
                                  {rateLabel}
                                </Text>
                              </YStack>
                            ) : rates ? (
                              <Text
                                caption2
                                color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"}
                                numberOfLines={1}
                              >
                                {rateLabel ?? t("N/A")}
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
}

const CARD_SIZE = 104;
const GAP = 8;
const PADDING = 16;
const INSTALLMENTS = Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1);
