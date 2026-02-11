import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import Carousel, { type ICarouselInstance } from "react-native-reanimated-carousel";

import { impactAsync, ImpactFeedbackStyle } from "expo-haptics";
import { useRouter } from "expo-router";

import { Check, X } from "@tamagui/lucide-icons";
import { View, XStack, YStack } from "tamagui";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import reportError from "../../utils/reportError";
import useInstallmentRates from "../../utils/useInstallmentRates";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import StyledButton from "../shared/StyledButton";
import Text from "../shared/Text";

export default function InstallmentsSheet({
  mode,
  isPending,
  onClose,
  onModeChange,
  open,
}: {
  isPending: boolean;
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
    if (open) setSelected(mode > 0 ? mode : 1); // eslint-disable-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
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
      <SafeView
        paddingTop={0}
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5" paddingTop="$s5">
          <YStack gap="$s5">
            <YStack gap="$s4" paddingHorizontal="$s5">
              <XStack justifyContent="space-between" alignItems="center" gap="$s3">
                <Text emphasized headline flex={1}>
                  {t("Set installments")}
                </Text>
                <Pressable aria-label={t("Close")} role="button" hitSlop={15} onPress={onClose}>
                  <X size={24} color="$uiNeutralPrimary" />
                </Pressable>
              </XStack>
              <Text subHeadline secondary>
                {t(
                  "Choose how many installments to use for future card purchases. You can always change this before each purchase.",
                )}
              </Text>
            </YStack>
            <View overflow="hidden" onLayout={handleLayout}>
              {width === 0 ? undefined : (
                <Carousel
                  ref={carouselRef}
                  width={pageWidth}
                  height={CARD_SIZE}
                  style={{ width: width - PADDING, marginLeft: PADDING, overflow: "visible" }}
                  data={pages}
                  defaultIndex={Math.floor((Math.max(mode, 1) - 1) / perPage)}
                  loop={false}
                  renderItem={({ item: page }) => (
                    <XStack gap={GAP}>
                      {page.map((installment) => {
                        const isSelected = selected === installment;
                        return (
                          <YStack
                            key={installment}
                            width={CARD_SIZE}
                            height={CARD_SIZE}
                            borderRadius="$r3"
                            alignItems="center"
                            justifyContent="center"
                            gap="$s3_5"
                            backgroundColor={isSelected ? "$cardCreditInteractive" : "transparent"}
                            borderWidth={1}
                            borderColor={isSelected ? "$cardCreditInteractive" : "$cardCreditBorder"}
                            animation="quick"
                            animateOnly={["transform"]}
                            pressStyle={{ scale: 0.96 }}
                            cursor="pointer"
                            onPress={() => {
                              setSelected(installment);
                              impactAsync(ImpactFeedbackStyle.Medium).catch(reportError);
                              const target = Math.floor((installment - 1) / perPage);
                              if (target !== carouselRef.current?.getCurrentIndex()) {
                                requestAnimationFrame(() =>
                                  carouselRef.current?.scrollTo({ index: target, animated: true }),
                                );
                              }
                            }}
                          >
                            <Text title2 emphasized color={isSelected ? "$cardCreditText" : "$cardCreditInteractive"}>
                              {installment}
                            </Text>
                            {rates ? (
                              rates.installments[installment - 1]?.payments === undefined ? (
                                <Text
                                  caption2
                                  color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"}
                                  numberOfLines={1}
                                >
                                  {t("N/A")}
                                </Text>
                              ) : (
                                <Text
                                  caption2
                                  color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"}
                                  numberOfLines={1}
                                >
                                  {t("{{apr}} APR", {
                                    apr: (Number(rates.installments[installment - 1]?.rate) / 1e18).toLocaleString(
                                      language,
                                      { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 },
                                    ),
                                  })}
                                </Text>
                              )
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
          <YStack gap="$s4" paddingHorizontal="$s4">
            <StyledButton
              primary
              disabled={selected === mode || isPending}
              loading={isPending}
              onPress={() => {
                onModeChange(selected);
              }}
            >
              <StyledButton.Text>{t("Set Pay Later in {{count}}", { count: selected })}</StyledButton.Text>
              <StyledButton.Icon>
                <Check />
              </StyledButton.Icon>
            </StyledButton>
            <Pressable
              hitSlop={15}
              onPress={() => {
                onClose();
                router.push("/calculator");
              }}
            >
              <Text footnote emphasized brand textAlign="center">
                {t("Installments calculator")}
              </Text>
            </Pressable>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}

const CARD_SIZE = 104;
const GAP = 8;
const PADDING = 24;
const INSTALLMENTS = Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1);
