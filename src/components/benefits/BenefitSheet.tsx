import React from "react";
import { useTranslation } from "react-i18next";

import { ExternalLink, X } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Benefit } from "./BenefitsSection";

type BenefitSheetProperties = {
  benefit: Benefit | undefined;
  onClose: () => void;
  open: boolean;
};

export default function BenefitSheet({ benefit, open, onClose }: BenefitSheetProperties) {
  const {
    t,
    i18n: { language },
  } = useTranslation();

  if (!benefit) return null;

  const LogoComponent = benefit.logo;

  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView
        paddingTop={0}
        $platform-web={{ paddingBottom: "$s4" }}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <View position="absolute" top="$s5" right="$s5" zIndex={10}>
          <IconButton icon={X} size={25} color="$uiNeutralSecondary" aria-label={t("Close")} onPress={onClose} />
        </View>
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <YStack gap="$s3" paddingHorizontal="$s5" paddingVertical="$s7">
            <YStack gap="$s3" paddingBottom="$s4">
              <XStack alignItems="center" gap="$s3">
                <LogoComponent width={32} height={32} />
                <Text emphasized title3>
                  {t(benefit.partner)}
                </Text>
              </XStack>

              <Text emphasized title>
                {t(benefit.longTitle ?? benefit.title)}
              </Text>
              {benefit.descriptions && (
                <YStack gap="$s4">
                  {benefit.descriptions.map((description) => (
                    <Text key={description} subHeadline secondary>
                      {t(description)}
                    </Text>
                  ))}
                </YStack>
              )}
            </YStack>
            <Button
              backgroundColor="$interactiveBaseBrandDefault"
              justifyContent="space-between"
              minHeight={64}
              padding="$s4"
              onPress={() => {
                if (!benefit.url) return;
                openBrowser(benefit.url.replace("{language}", language.split("-")[0] ?? "en")).catch(reportError);
              }}
            >
              <Button.Text emphasized subHeadline color="$interactiveOnBaseBrandDefault">
                {benefit.buttonText ? t(benefit.buttonText) : t("Get benefit")}
              </Button.Text>
              <ExternalLink size={20} color="$interactiveOnBaseBrandDefault" />
            </Button>

            {benefit.termsURL && (
              <Button
                flex={1}
                transparent
                justifyContent="center"
                onPress={() => {
                  if (!benefit.termsURL) return;
                  openBrowser(benefit.termsURL).catch(reportError);
                }}
              >
                <Button.Text emphasized footnote textAlign="center">
                  {t("Terms & conditions")}
                </Button.Text>
              </Button>
            )}
          </YStack>
        </ScrollView>
      </SafeView>
    </ModalSheet>
  );
}
