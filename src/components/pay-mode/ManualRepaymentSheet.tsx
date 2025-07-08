import { ArrowRight, Check } from "@tamagui/lucide-icons";
import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ManualRepaymentSheet({
  open,
  onClose,
  onActionPress,
  penaltyRate,
}: {
  open: boolean;
  onClose: () => void;
  onActionPress: () => void;
  penaltyRate?: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [acknowledged, setAcknowledged] = useState(true);
  return (
    <ModalSheet key={open ? "open" : "closed"} open={open} onClose={onClose} disableDrag>
      <SafeView
        paddingTop={0}
        $platform-web={{ paddingBottom: "$s4" }}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <View fullScreen flex={1}>
            <YStack flex={1} paddingHorizontal="$s5" paddingTop="$s7" gap="$s4">
              <YStack flex={1} gap="$s5">
                <Text emphasized headline>
                  {t("How installment repayment works")}
                </Text>
                <Text subHeadline secondary>
                  <Trans
                    i18nKey="When you make a purchase using an installment plan, <highlight>you must pay each installment manually before the due date.</highlight> Otherwise, a daily penalty of {{rate}} is added while the payment is late."
                    values={{
                      rate: (penaltyRate ? Number(penaltyRate * 86_400n) / 1e18 : 0).toLocaleString(language, {
                        style: "percent",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }),
                    }}
                    components={{ highlight: <Text color="$uiInfoSecondary" /> }}
                  />
                </Text>
              </YStack>
              <Separator height={1} borderColor="$borderNeutralSoft" paddingVertical="$s2" />
              <YStack gap="$s4_5">
                <XStack
                  alignItems="center"
                  gap="$s4"
                  flex={1}
                  justifyContent="flex-start"
                  onPress={() => {
                    setAcknowledged(!acknowledged);
                  }}
                >
                  <XStack cursor="pointer" gap="$s3" flex={1} alignItems="center">
                    <View
                      width={16}
                      height={16}
                      backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                      borderColor="$backgroundBrand"
                      borderWidth={1}
                      borderRadius="$r2"
                      justifyContent="center"
                      alignItems="center"
                    >
                      {acknowledged && <Check size="$iconSize.xs" color="white" />}
                    </View>
                    <Text color="$uiNeutralSecondary" caption flex={1}>
                      {t("I understand I have to repay each installment before the due date to avoid daily penalties.")}
                    </Text>
                  </XStack>
                </XStack>
                <Button onPress={onActionPress} primary disabled={!acknowledged}>
                  <Button.Text>{t("Close")}</Button.Text>
                  <Button.Icon>
                    <ArrowRight />
                  </Button.Icon>
                </Button>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
