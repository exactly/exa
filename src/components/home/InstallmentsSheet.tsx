import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dimensions, Pressable, ScrollView, StyleSheet } from "react-native";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { Check, X } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import reportError from "../../utils/reportError";
import useInstallmentRates from "../../utils/useInstallmentRates";
import Button from "../shared/Button";
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
    if (open) setSelected(mode > 0 ? mode : 1); // eslint-disable-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
  }, [mode, open]);
  const rates = useInstallmentRates();
  const initial = Math.max(mode, 1);
  const initialX = Math.max(
    0,
    PADDING + (initial - 1) * (CARD_SIZE + GAP) + CARD_SIZE + PADDING - Dimensions.get("window").width,
  );
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={CARD_SIZE + GAP}
              decelerationRate="fast"
              contentContainerStyle={styles.scrollContent}
              contentOffset={{ x: initialX, y: 0 }}
            >
              {INSTALLMENTS.map((installment) => {
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
                      selectionAsync().catch(reportError);
                    }}
                  >
                    <Text title2 emphasized color={isSelected ? "$cardCreditText" : "$cardCreditInteractive"}>
                      {installment}
                    </Text>
                    {rates ? (
                      rates.installments[installment - 1]?.payments === undefined ? (
                        <Text caption2 color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"} numberOfLines={1}>
                          {t("N/A")}
                        </Text>
                      ) : (
                        <Text caption2 color={isSelected ? "$cardCreditText" : "$uiNeutralSecondary"} numberOfLines={1}>
                          {t("{{apr}} APR", {
                            apr: (Number(rates.installments[installment - 1]?.rate) / 1e18).toLocaleString(language, {
                              style: "percent",
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            }),
                          })}
                        </Text>
                      )
                    ) : (
                      <Skeleton height={12} width={48} />
                    )}
                  </YStack>
                );
              })}
            </ScrollView>
          </YStack>
          <YStack gap="$s4" paddingHorizontal="$s4">
            <Button
              onPress={() => {
                if (selected !== mode) onModeChange(selected);
                onClose();
              }}
              contained
              main
              spaced
              fullwidth
              iconAfter={<Check strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
            >
              {t("Set Pay Later in {{count}}", { count: selected })}
            </Button>
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

const styles = StyleSheet.create({
  scrollContent: { gap: GAP, paddingHorizontal: PADDING },
});
