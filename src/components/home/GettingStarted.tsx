import React from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowDownToLine, ArrowRight, ChevronRight, IdCard } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Spinner, XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import useBeginKYC from "../../utils/useBeginKYC";
import useOnboardingSteps from "../../utils/useOnboardingSteps";
import Text from "../shared/Text";
import View from "../shared/View";

import type { KYCState } from "../../utils/useKYC";

export default function GettingStarted({ isDeployed, kyc }: { isDeployed: boolean; kyc: KYCState }) {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToastController();
  const steps = useOnboardingSteps({ kyc, isDeployed });
  const { mutate: beginKYC, isPending } = useBeginKYC();
  const step = steps.find(({ status }) => status !== "completed");
  function handleStepPress() {
    if (isPending) return;
    switch (step?.status === "pending" ? step.id : undefined) {
      case "add-funds":
        router.push("/add-funds");
        break;
      case "verify-identity":
        beginKYC(undefined, {
          onError(error) {
            toast.show(t("Error verifying identity"), {
              duration: 1000,
              burntOptions: { haptic: "error", preset: "error" },
            });
            reportError(error);
          },
        });
        break;
      default:
        router.push("/getting-started");
    }
  }

  return (
    <YStack
      key="getting-started"
      backgroundColor="$backgroundBrandSoft"
      borderWidth={1}
      borderColor="$borderBrandSoft"
      borderRadius="$r3"
      opacity={1}
      transform={[{ translateY: 0 }]}
      animation="default"
      animateOnly={["opacity", "transform"]}
      enterStyle={{ opacity: 0, transform: [{ translateY: -20 }] }}
      exitStyle={{ opacity: 0, transform: [{ translateY: -20 }] }}
    >
      <XStack justifyContent="space-between" alignItems="center" padding="$s4">
        <Text emphasized headline color="$uiBrandSecondary" maxFontSizeMultiplier={1.3}>
          {t("Getting Started")}
        </Text>
        <Pressable hitSlop={15}>
          <XStack gap="$s1" alignItems="center">
            <Pressable
              hitSlop={15}
              onPress={() => {
                router.push("/getting-started");
              }}
            >
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                {t("View all steps")}
              </Text>
            </Pressable>
            <ChevronRight size={14 * PixelRatio.getFontScale()} color="$interactiveTextBrandDefault" />
          </XStack>
        </Pressable>
      </XStack>
      <XStack justifyContent="space-between" alignItems="center" padding="$s4">
        <XStack gap="$s3" alignItems="center" flex={1}>
          {step?.id === "add-funds" ? (
            <ArrowDownToLine size={24 * PixelRatio.getFontScale()} color="$uiBrandSecondary" />
          ) : (
            <IdCard size={24 * PixelRatio.getFontScale()} color="$uiBrandSecondary" />
          )}
          <Text emphasized headline color="$uiBrandSecondary" maxFontSizeMultiplier={1.3}>
            {step ? t(step.title) : ""}
          </Text>
        </XStack>
        <Pressable hitSlop={15} onPress={handleStepPress}>
          <View
            width={44}
            height={44}
            backgroundColor="$interactiveBaseBrandDefault"
            borderRadius="$r3"
            justifyContent="center"
            alignItems="center"
          >
            {isPending ? (
              <Spinner color="$interactiveOnBaseBrandDefault" size="small" />
            ) : (
              <ArrowRight size={24 * PixelRatio.getFontScale()} color="$interactiveOnBaseBrandDefault" />
            )}
          </View>
        </Pressable>
      </XStack>
    </YStack>
  );
}
