import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";

import { Copy, ExternalLink, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Benefit } from "./BenefitsSection";
import type { PaxId } from "../../utils/server";

const PAX_LOCALE: Record<string, string> = {
  es: "ar",
  pt: "br",
  en: "us",
};

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
  const toast = useToastController();

  const {
    data: paxData,
    isError: isPaxError,
    isLoading: isPaxLoading,
  } = useQuery<PaxId>({
    queryKey: ["pax", "id"],
    enabled: benefit?.id === "pax" && open,
  });

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
          <Pressable onPress={onClose} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
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
              <YStack gap="$s4">
                {benefit.descriptions.map((description) => (
                  <Text key={description} subHeadline secondary>
                    {t(description)}
                  </Text>
                ))}
              </YStack>
              {benefit.id === "pax" && (
                <Pressable
                  disabled={!paxData || isPaxError}
                  onPress={() => {
                    if (!paxData) return;
                    setStringAsync(paxData.associateId)
                      .then(() => {
                        toast.show(t("Pax ID copied!"), {
                          native: true,
                          duration: 1000,
                          burntOptions: { haptic: "success" },
                        });
                      })
                      .catch(reportError);
                  }}
                >
                  <XStack
                    backgroundColor="$backgroundMild"
                    borderRadius="$3"
                    padding="$s4"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    {isPaxLoading ? (
                      <Spinner color="$uiNeutralSecondary" />
                    ) : paxData ? (
                      <Text emphasized body fontFamily="$mono">
                        {paxData.associateId}
                      </Text>
                    ) : (
                      <Text body color="$uiNeutralSecondary">
                        {t("Failed to load")}
                      </Text>
                    )}
                    <XStack
                      alignItems="center"
                      gap="$s1"
                      backgroundColor="$interactiveBaseSuccessDefault"
                      paddingHorizontal="$s3"
                      paddingVertical="$s2"
                    >
                      <Text caption2 color="$interactiveOnBaseSuccessDefault">
                        {t("COPY ID")}
                      </Text>
                      <Copy size={16} color="$interactiveOnBaseSuccessDefault" />
                    </XStack>
                  </XStack>
                </Pressable>
              )}
            </YStack>
            <Button
              disabled={benefit.id === "pax" && (isPaxLoading || isPaxError || !paxData)}
              backgroundColor="$interactiveBaseBrandDefault"
              justifyContent="space-between"
              minHeight={64}
              padding="$s4"
              onPress={() => {
                const isPax = benefit.id === "pax";
                let url = isPax ? benefit.url.replace("{locale}", PAX_LOCALE[language] ?? "us") : benefit.url;
                if (isPax && paxData?.associateId) url += `?cid=${paxData.associateId}`;
                openBrowser(url).catch(reportError);
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
