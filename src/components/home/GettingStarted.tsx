import React from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowRight, ChevronRight, IdCard } from "@tamagui/lucide-icons";
import { Spinner, XStack, YStack } from "tamagui";

import useBeginKYC from "../../utils/useBeginKYC";
import useOnboardingSteps from "../../utils/useOnboardingSteps";
import Text from "../shared/Text";
import View from "../shared/View";

export default function GettingStarted({ isDeployed, hasKYC }: { hasKYC: boolean; isDeployed: boolean }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentStep, completedSteps } = useOnboardingSteps({ hasKYC, isDeployed });
  const { mutate: beginKYC, isPending } = useBeginKYC();
  function handleStepPress() {
    if (isPending) return;
    switch (currentStep?.id) {
      case "add-funds":
        router.push("/add-funds/add-crypto");
        break;
      case "verify-identity":
        beginKYC();
        break;
    }
  }

  const activeStepTitle = currentStep ? t(currentStep.title) : "";

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
                if (!currentStep) return;
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
        <YStack gap="$s3">
          <XStack gap="$s3" alignItems="center">
            <IdCard size={24 * PixelRatio.getFontScale()} color="$uiBrandSecondary" />
            <Text emphasized headline color="$uiBrandSecondary" maxFontSizeMultiplier={1.3}>
              {activeStepTitle}
            </Text>
          </XStack>
          <XStack gap="$s3_5" alignItems="center">
            <XStack alignItems="center" gap="$s2">
              {Array.from({ length: 3 }).map((_, index) => (
                <View
                  key={index} // eslint-disable-line @eslint-react/no-array-index-key
                  backgroundColor={completedSteps > index ? "$interactiveBaseBrandDefault" : "$uiBrandTertiary"}
                  width={24}
                  height={8}
                  borderRadius="$r_0"
                />
              ))}
            </XStack>
            <Text emphasized subHeadline color="$uiBrandTertiary">
              {completedSteps}/3
            </Text>
          </XStack>
        </YStack>
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
