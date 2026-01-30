import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowDownToLine, ArrowLeft, Check, IdCard } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import Step from "./Step";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import { getKYCStatus } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useBeginKYC from "../../utils/useBeginKYC";
import useOnboardingSteps from "../../utils/useOnboardingSteps";
import ActionButton from "../shared/ActionButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

function useOnboardingState() {
  const { address: account } = useAccount();
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });
  const { data: kycStatus } = useQuery({ queryKey: ["kyc", "status"], queryFn: async () => getKYCStatus() });
  const isDeployed = !!bytecode;
  const hasKYC = Boolean(
    kycStatus &&
    typeof kycStatus === "object" &&
    "code" in kycStatus &&
    (kycStatus.code === "ok" || kycStatus.code === "legacy kyc"),
  );
  return { hasKYC, isDeployed };
}

export default function GettingStarted() {
  const { t } = useTranslation();
  const router = useRouter();
  const { hasKYC, isDeployed } = useOnboardingState();
  const { steps } = useOnboardingSteps({ hasKYC, isDeployed });
  return (
    <SafeView fullScreen backgroundColor="$backgroundBrandSoft" paddingBottom={0}>
      <View gap={20} fullScreen>
        <View gap={20} padded paddingBottom={0}>
          <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <Pressable
                aria-label={t("Back")}
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
              {t("Getting started")}
            </Text>
          </View>
        </View>
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <CurrentStep hasKYC={hasKYC} isDeployed={isDeployed} />
          <YStack
            backgroundColor="$backgroundSoft"
            paddingHorizontal="$s5"
            paddingVertical="$s7"
            gap="$s6"
            height="100%"
          >
            <YStack gap="$s4">
              <Text emphasized headline primary>
                {t("Remaining steps")}
              </Text>
              <Text footnote secondary>
                {t("You are almost set to start using the Exa Card.")}
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
                  {t("Account created")}
                </Text>
              </XStack>
              <Step
                title={t("Add funds to your account")}
                description={t("Your funds serve as collateral to increase your spending limits.")}
                action={t("Learn more about collateral")}
                icon={<ArrowDownToLine size={20} strokeWidth={2} color="$uiBrandSecondary" />}
                completed={steps.find(({ id }) => id === "add-funds")?.completed ?? false}
                onPress={() => {
                  presentArticle("8950805").catch(reportError);
                }}
              />
              <Step
                title={t("Verify your identity")}
                description={t("To enable the Exa Card we need to verify that you are you.")}
                action={t("Learn more about the KYC process")}
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

function CurrentStep({ hasKYC, isDeployed }: { hasKYC: boolean; isDeployed: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { currentStep, completedSteps } = useOnboardingSteps({ hasKYC, isDeployed });
  const { mutate: beginKYC } = useBeginKYC();
  function handleAction() {
    switch (currentStep?.id) {
      case "add-funds":
        router.push("/add-funds/add-crypto");
        break;
      case "verify-identity":
        beginKYC();
        break;
    }
  }
  if (!currentStep) return null;
  return (
    <YStack gap="$s6" borderBottomWidth={1} borderBottomColor="$borderBrandSoft" padding="$s4">
      <YStack gap="$s4">
        <XStack>
          {currentStep.id === "add-funds" ? (
            <ArrowDownToLine size={32} color="$uiBrandSecondary" />
          ) : (
            <IdCard size={32} color="$uiBrandSecondary" />
          )}
        </XStack>
        <Text emphasized title3 color="$uiBrandSecondary">
          {currentStep.id === "add-funds" ? t("Add funds to your account") : t("Verify your identity")}
        </Text>
      </YStack>
      <YStack>
        <Text subHeadline color="$uiNeutralSecondary">
          {currentStep.id === "add-funds"
            ? t(
                "Your funds serve as collateral, increasing your spending limits. The more funds you add, the more you can spend with the Exa Card.",
              )
            : t(
                "Verifying your identity grants you access to our onchain Exa Card, enabling you to easily spend your crypto.",
              )}
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
          {currentStep.id === "add-funds" ? t("Add funds") : t("Begin verifying")}
        </ActionButton>
      </YStack>
    </YStack>
  );
}

function StepCounter({ completedSteps }: { completedSteps: number }) {
  const { t } = useTranslation();
  const remainingSteps = 3 - completedSteps;
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
          {t("{{count}} step remaining", { count: remainingSteps })}
        </Text>
        <Text emphasized subHeadline color="$uiBrandTertiary">
          {completedSteps}/3
        </Text>
      </XStack>
    </YStack>
  );
}
