import { X } from "@tamagui/lucide-icons";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function SpendingLimitsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s7">
            <YStack gap="$s5">
              <Text emphasized primary headline>
                {t("Spending limit")}
              </Text>
              <Text primary subHeadline>
                {t("Your spending limit is the maximum amount you can spend on your Exa Card.")}
              </Text>
            </YStack>
            <YStack gap="$s3_5">
              <YStack
                gap="$s3_5"
                borderRadius="$r3"
                backgroundColor="$backgroundMild"
                paddingHorizontal="$s4"
                paddingVertical="$s4_5"
              >
                <XStack gap="$s3" alignItems="center" flexWrap="wrap">
                  <Text emphasized secondary footnote>
                    {t("WHEN")}
                  </Text>
                  <View
                    alignSelf="center"
                    justifyContent="center"
                    alignItems="center"
                    backgroundColor="$cardDebitInteractive"
                    borderRadius="$r2"
                    paddingVertical="$s2"
                    paddingHorizontal="$s3"
                  >
                    <Text
                      emphasized
                      secondary
                      footnote
                      textTransform="uppercase"
                      color="$cardDebitText"
                      maxFontSizeMultiplier={1}
                    >
                      {t("PAY NOW")}
                    </Text>
                  </View>
                  <Text emphasized secondary footnote>
                    {t("IS ENABLED")}
                  </Text>
                </XStack>
                <Text subHeadline>{t("Only your USDC balance counts toward your spending limit.")}</Text>
              </YStack>
              <YStack
                gap="$s3_5"
                borderRadius="$r3"
                backgroundColor="$backgroundMild"
                paddingHorizontal="$s4"
                paddingVertical="$s4_5"
              >
                <XStack gap="$s3" alignItems="center" flexWrap="wrap">
                  <Text emphasized secondary footnote>
                    {t("WHEN")}
                  </Text>
                  <View
                    alignSelf="center"
                    justifyContent="center"
                    alignItems="center"
                    backgroundColor="$cardCreditInteractive"
                    borderRadius="$r2"
                    paddingVertical="$s2"
                    paddingHorizontal="$s3"
                  >
                    <Text
                      emphasized
                      secondary
                      footnote
                      textTransform="uppercase"
                      color="$cardCreditText"
                      maxFontSizeMultiplier={1}
                    >
                      {t("INSTALLMENTS")}
                    </Text>
                  </View>
                  <Text emphasized secondary footnote>
                    {t("IS ENABLED")}
                  </Text>
                </XStack>
                <Text subHeadline>{t("All supported assets count toward your spending limit.")}</Text>
              </YStack>
            </YStack>
            <YStack gap="$s5">
              <Button
                onPress={onClose}
                flexBasis={60}
                contained
                main
                spaced
                fullwidth
                iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
              >
                {t("Close")}
              </Button>
              <Pressable
                onPress={() => {
                  presentArticle("9922633").catch(reportError);
                }}
              >
                <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
                  {t("Learn more about your spending limit")}
                </Text>
              </Pressable>
            </YStack>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
