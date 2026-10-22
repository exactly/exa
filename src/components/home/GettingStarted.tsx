import React from "react";
import { useTranslation } from "react-i18next";
import { PixelRatio, Pressable } from "react-native";
import { FadeIn, FadeOut } from "react-native-reanimated";

import { useRouter } from "expo-router";

import { ArrowDownToLine } from "@tamagui/lucide-icons-2/icons/ArrowDownToLine";
import { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { ChevronRight } from "@tamagui/lucide-icons-2/icons/ChevronRight";
import { IdCard } from "@tamagui/lucide-icons-2/icons/IdCard";
import { toast } from "@tamagui/toast";
import { Spinner, XStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import reportError from "../../utils/reportError";
import useBeginKYC from "../../utils/useBeginKYC";
import useOnboardingSteps from "../../utils/useOnboardingSteps";
import AnimatedView from "../shared/AnimatedView";
import Text from "../shared/Text";
import View from "../shared/View";

import type { KYCState } from "../../utils/useKYC";

export default function GettingStarted({ isDeployed, kyc }: { isDeployed: boolean; kyc: KYCState }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { mutate: beginKYC, isPending } = useBeginKYC();
  const step = useOnboardingSteps({ kyc, isDeployed }).find(({ status }) => status !== "completed");
  function handleStepPress() {
    if (isPending) return;
    switch (step?.status === "pending" ? step.id : undefined) {
      case "add-funds":
        router.push("/add-funds");
        break;
      case "verify-identity":
        beginKYC(undefined, {
          onError(error) {
            toast.error(t("Error verifying identity"), { duration: 1000 });
            reportError(error);
          },
        });
        break;
      default:
        router.push("/getting-started");
    }
  }

  return (
    <AnimatedView
      entering={FadeIn}
      exiting={FadeOut}
      backgroundColor="backgroundBrandSoft"
      borderWidth={1}
      borderColor="borderBrandSoft"
      borderRadius="r3"
    >
      <XStack justifyContent="space-between" alignItems="center" padding="s4">
        <Text emphasized headline color="uiBrandSecondary" maxFontSizeMultiplier={1.3}>
          {t("Getting Started")}
        </Text>
        <Pressable hitSlop={15}>
          <XStack gap="s1" alignItems="center">
            <Pressable
              hitSlop={15}
              onPress={() => {
                router.push("/getting-started");
              }}
            >
              <Text emphasized footnote color="interactiveBaseBrandDefault">
                {t("View all steps")}
              </Text>
            </Pressable>
            <ChevronRight size={14 * PixelRatio.getFontScale()} color="interactiveTextBrandDefault" />
          </XStack>
        </Pressable>
      </XStack>
      <XStack justifyContent="space-between" alignItems="center" padding="s4">
        <XStack gap="s3" alignItems="center" flex={1}>
          {step?.id === "add-funds" ? (
            <ArrowDownToLine size={24 * PixelRatio.getFontScale()} color="uiBrandSecondary" />
          ) : (
            <IdCard size={24 * PixelRatio.getFontScale()} color="uiBrandSecondary" />
          )}
          <Text emphasized headline color="uiBrandSecondary" maxFontSizeMultiplier={1.3}>
            {step ? t(step.title, { chain: chain.name }) : ""}
          </Text>
        </XStack>
        <Pressable hitSlop={15} onPress={handleStepPress}>
          <View
            width={44}
            height={44}
            backgroundColor="interactiveBaseBrandDefault"
            borderRadius="r3"
            justifyContent="center"
            alignItems="center"
          >
            {isPending ? (
              <Spinner color="interactiveOnBaseBrandDefault" size="small" />
            ) : (
              <ArrowRight size={24 * PixelRatio.getFontScale()} color="interactiveOnBaseBrandDefault" />
            )}
          </View>
        </Pressable>
      </XStack>
    </AnimatedView>
  );
}
