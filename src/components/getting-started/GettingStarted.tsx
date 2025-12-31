import type { Credential } from "@exactly/common/validation";
import { ArrowDownToLine, ArrowLeft, Check, IdCard } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";

import Step from "./Step";
import { presentArticle } from "../../utils/intercom";
import { createInquiry, KYC_TEMPLATE_ID, resumeInquiry } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getKYCStatus } from "../../utils/server";
import useOnboardingSteps from "../../utils/useOnboardingSteps";
import ActionButton from "../shared/ActionButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function GettingStarted() {
  const router = useRouter();
  const { steps } = useOnboardingSteps();
  return (
    <SafeView fullScreen backgroundColor="$backgroundBrandSoft" paddingBottom={0}>
      <View gap={20} fullScreen>
        <View gap={20} padded paddingBottom={0}>
          <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(main)/(home)");
                  }
                }}
              >
                <ArrowLeft size={24} color="$uiNeutralPrimary" />
              </Pressable>
            </View>
            <Text color="$uiNeutralPrimary" fontSize={15} fontWeight="bold">
              Getting started
            </Text>
          </View>
        </View>
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <CurrentStep />
          <YStack
            backgroundColor="$backgroundSoft"
            paddingHorizontal="$s5"
            paddingVertical="$s7"
            gap="$s6"
            height="100%"
          >
            <YStack gap="$s4">
              <Text emphasized headline primary>
                Remaining steps
              </Text>
              <Text footnote secondary>
                You are almost set to start using the Exa Card.
              </Text>
            </YStack>
            <YStack gap="$s4">
              <XStack
                backgroundColor="$interactiveBaseSuccessSoftDefault"
                alignItems="center"
                padding="$s4_5"
                borderRadius="$r3"
                borderWidth={1}
                borderColor="$borderSuccessSoft"
                gap="$s3_5"
              >
                <View
                  width={24}
                  height={24}
                  borderRadius="$r_0"
                  backgroundColor="$uiSuccessSecondary"
                  borderWidth={2}
                  borderColor="$uiSuccessTertiary"
                  alignItems="center"
                  justifyContent="center"
                  padding="$s2"
                >
                  <Check size={14} strokeWidth={4} color="$interactiveOnBaseSuccessDefault" />
                </View>
                <Text emphasized subHeadline color="$uiBrandSecondary">
                  Account created
                </Text>
              </XStack>
              <Step
                title="Add funds to your account"
                description="Your funds serve as collateral to increase your spending limits."
                action="Learn more about collateral"
                icon={<ArrowDownToLine size={20} strokeWidth={2} color="$uiBrandSecondary" />}
                completed={steps.find(({ id }) => id === "add-funds")?.completed ?? false}
                onPress={() => {
                  presentArticle("8950805").catch(reportError);
                }}
              />
              <Step
                title="Verify your identity"
                description="To enable the Exa Card we need to verify that you are you."
                action="Learn more about the KYC process"
                icon={<IdCard size={20} strokeWidth={2} color="$uiBrandSecondary" />}
                completed={steps.find(({ id }) => id === "verify-identity")?.completed ?? false}
                onPress={() => {
                  presentArticle("9448693").catch(reportError);
                }}
              />
            </YStack>
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}

function CurrentStep() {
  const router = useRouter();
  const { currentStep, completedSteps } = useOnboardingSteps();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { mutateAsync: startKYC } = useMutation({
    mutationKey: ["kyc"],
    mutationFn: async () => {
      if (!credential) throw new Error("missing credential");
      try {
        const result = await getKYCStatus(KYC_TEMPLATE_ID);
        if (result === "ok") return;
        if (typeof result !== "string") {
          await resumeInquiry(result.inquiryId, result.sessionToken);
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
  function handleAction() {
    switch (currentStep?.id) {
      case "add-funds":
        router.push("/add-funds/add-crypto");
        break;
      case "verify-identity":
        startKYC().catch(reportError);
        break;
    }
  }
  if (!currentStep) return null;
  return (
    <YStack gap="$s6" borderBottomWidth={1} borderBottomColor="$borderBrandSoft" padding="$s4">
      <YStack gap="$s4">
        <XStack>
          <ArrowDownToLine size={32} color="$uiBrandSecondary" />
        </XStack>
        <Text emphasized title3 color="$uiBrandSecondary">
          {currentStep.id === "add-funds" ? "Add funds to your account" : "Verify your identity"}
        </Text>
      </YStack>
      <YStack>
        <Text subHeadline color="$uiNeutralSecondary">
          {currentStep.id === "add-funds"
            ? "Your funds serve as collateral, increasing your spending limits. The more funds you add, the more you can spend with the Exa Card."
            : "Verifying your identity grants you access to our onchain Exa Card, enabling you to easily spend your crypto."}
        </Text>
      </YStack>
      <StepCounter completedSteps={completedSteps} />
      <YStack>
        <ActionButton
          marginTop="$s4"
          marginBottom="$s5"
          onPress={handleAction}
          iconAfter={
            currentStep.id === "add-funds" ? (
              <ArrowDownToLine size={20} color="$interactiveOnBaseBrandDefault" strokeWidth={2} />
            ) : (
              <IdCard size={20} color="$interactiveOnBaseBrandDefault" strokeWidth={2} />
            )
          }
        >
          {currentStep.id === "add-funds" ? "Add funds" : "Begin verifying"}
        </ActionButton>
      </YStack>
    </YStack>
  );
}

function StepCounter({ completedSteps }: { completedSteps: number }) {
  return (
    <YStack gap="$s3_5">
      <XStack flex={1} gap="$s2">
        {Array.from({ length: 3 }).map((_, index) => (
          <XStack
            key={index} // eslint-disable-line @eslint-react/no-array-index-key
            backgroundColor={completedSteps > index ? "$interactiveBaseBrandDefault" : "$uiBrandTertiary"}
            height={8}
            borderRadius="$r_0"
            flex={1}
          />
        ))}
      </XStack>
      <XStack justifyContent="space-between" gap="$s3">
        <Text emphasized subHeadline color="$uiBrandTertiary">
          {completedSteps > 1 ? "One step left" : "Two steps left"}
        </Text>
        <Text emphasized subHeadline color="$uiBrandTertiary">
          {completedSteps}/3
        </Text>
      </XStack>
    </YStack>
  );
}
