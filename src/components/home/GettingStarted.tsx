import type { Credential } from "@exactly/common/validation";
import { ArrowRight, ChevronRight, IdCard } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useContext, useEffect } from "react";
import { PixelRatio, Pressable } from "react-native";
import { Spinner, XStack, YStack } from "tamagui";

import { createInquiry, KYC_TEMPLATE_ID, resumeInquiry } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getKYCStatus } from "../../utils/server";
import { OnboardingContext } from "../context/OnboardingProvider";
import Text from "../shared/Text";
import View from "../shared/View";

export default function GettingStarted({ hasFunds, hasKYC }: { hasFunds: boolean; hasKYC: boolean }) {
  const { steps, currentStep, completedSteps, setSteps } = useContext(OnboardingContext);
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { mutateAsync: startKYC, isPending } = useMutation({
    mutationKey: ["kyc"],
    mutationFn: async () => {
      if (!credential) throw new Error("missing credential");
      try {
        const result = await getKYCStatus(KYC_TEMPLATE_ID);
        if (result === "ok") return;
        if (typeof result !== "string") {
          resumeInquiry(result.inquiryId, result.sessionToken).catch(reportError);
        }
      } catch (error) {
        if (!(error instanceof APIError)) {
          reportError(error);
          return;
        }
        if (error.text === "kyc required" || error.text === "kyc not found" || error.text === "kyc not started") {
          await createInquiry(credential);
          return;
        }
        reportError(error);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kyc", "status"] });
    },
  });
  function handleStepPress() {
    if (isPending) return;
    switch (currentStep?.id) {
      case "add-funds":
        router.push("/add-funds/add-crypto");
        break;
      case "verify-identity":
        startKYC().catch(reportError);
        break;
    }
  }
  useEffect(() => {
    setSteps((previous) => {
      return previous.map((step) => {
        if (step.id === "add-funds" && hasFunds) return { ...step, completed: true };
        if (step.id === "verify-identity" && hasKYC) return { ...step, completed: true };
        return step;
      });
    });
  }, [hasFunds, hasKYC, setSteps]);

  if (hasFunds && hasKYC) return null;

  return (
    <YStack backgroundColor="$backgroundBrandSoft" borderWidth={1} borderColor="$borderBrandSoft" borderRadius="$r3">
      <XStack justifyContent="space-between" alignItems="center" padding="$s4">
        <Text emphasized headline color="$uiBrandSecondary" maxFontSizeMultiplier={1.3}>
          Getting Started
        </Text>
        <Pressable hitSlop={15}>
          <XStack gap={2} alignItems="center">
            <Pressable
              hitSlop={15}
              onPress={() => {
                if (!currentStep) return;
                router.push("/getting-started");
              }}
            >
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                View all steps
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
              {steps.find(({ completed }) => !completed)?.title}
            </Text>
          </XStack>
          <XStack gap="$s3_5" alignItems="center">
            <XStack alignItems="center" gap="$s2">
              {Array.from({ length: 3 }).map((_, index) => (
                <View
                  key={index}
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
