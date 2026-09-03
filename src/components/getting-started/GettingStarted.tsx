import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowDownToLine, ArrowLeft, IdCard } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useBytecode } from "wagmi";

import chain from "@exactly/common/generated/chain";

import Step from "./Step";
import { present, presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useBeginKYC from "../../utils/useBeginKYC";
import useKYC from "../../utils/useKYC";
import useOnboardingSteps from "../../utils/useOnboardingSteps";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function GettingStarted() {
  const { t } = useTranslation();
  const router = useRouter();
  const { address: account } = useAccount();
  const { data: bytecode } = useBytecode({ address: account, chainId: chain.id, query: { enabled: !!account } });
  const { status: kyc, error, isFetched } = useKYC();
  const steps = useOnboardingSteps({ kyc, isDeployed: !!bytecode });
  const currentStep = steps.find(({ status }) => status === "pending");
  return (
    <SafeView fullScreen backgroundColor="$backgroundBrandSoft" paddingBottom={0}>
      <View gap="$s4_5" fullScreen>
        <View gap="$s4_5" padded paddingBottom={0}>
          <View flexDirection="row" gap="$s3_5" justifyContent="space-around" alignItems="center">
            <View position="absolute" left={0}>
              <IconButton
                icon={ArrowLeft}
                aria-label={t("Back")}
                onPress={() => {
                  if (router.canGoBack()) {
                    router.back();
                  } else {
                    router.replace("/(main)/(home)");
                  }
                }}
              />
            </View>
            <Text color="$uiNeutralPrimary" emphasized subHeadline>
              {t("Getting started")}
            </Text>
          </View>
        </View>
        <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
          {isFetched && !error && currentStep && <CurrentStep id={currentStep.id} />}
          <YStack backgroundColor="$backgroundSoft" paddingHorizontal="$s5" paddingVertical="$s7" gap="$s6" flex={1}>
            <YStack gap="$s4">
              <Text emphasized headline primary>
                {t("Remaining steps")}
              </Text>
              <Text footnote secondary>
                {t("You are almost set to start using the Exa Card.")}
              </Text>
            </YStack>
            <YStack gap="$s4">
              {steps.map(({ id, status, title }) => (
                <Step
                  key={id}
                  title={t(title)}
                  status={status}
                  tag={
                    status === "review" ? t("IN REVIEW") : status === "failed" ? t("VERIFICATION FAILED") : undefined
                  }
                  {...(id === "verify-identity" && {
                    icon: <IdCard size={20} strokeWidth={2} color="$uiBrandSecondary" />,
                    description:
                      status === "review"
                        ? t("We’re reviewing the documents you submitted. This usually takes 2 to 3 business days.")
                        : status === "failed"
                          ? t(
                              "This may be due to missing or incorrect information. Please contact support to resolve it.",
                            )
                          : t("To enable the Exa Card we need to verify that you are you."),
                    action: status === "failed" ? t("Contact support") : t("Learn more about KYC process"),
                    onPress: () => {
                      (status === "failed" ? present() : presentArticle("9448693")).catch(reportError);
                    },
                  })}
                  {...(id === "add-funds" && {
                    icon: <ArrowDownToLine size={20} strokeWidth={2} color="$uiBrandSecondary" />,
                    description: t("Your funds serve as collateral to increase your spending limits."),
                    action: t("Learn more about collateral"),
                    onPress: () => {
                      presentArticle("8950805").catch(reportError);
                    },
                  })}
                />
              ))}
            </YStack>
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}

function CurrentStep({ id }: { id: "add-funds" | "create-account" | "verify-identity" }) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const beginKYC = useBeginKYC();
  const addFunds = id === "add-funds";
  return (
    <YStack gap="$s6" borderBottomWidth={1} borderBottomColor="$borderBrandSoft" padding="$s4">
      <YStack gap="$s4">
        <XStack>
          {addFunds ? (
            <ArrowDownToLine size={32} color="$uiBrandSecondary" />
          ) : (
            <IdCard size={32} color="$uiBrandSecondary" />
          )}
        </XStack>
        <Text emphasized title3 color="$uiBrandSecondary">
          {addFunds ? t("Add funds to your account") : t("Verify your identity")}
        </Text>
      </YStack>
      <YStack>
        <Text subHeadline color="$uiNeutralSecondary">
          {addFunds
            ? t(
                "Your funds serve as collateral, increasing your spending limits. The more funds you add, the more you can spend with the Exa Card.",
              )
            : t(
                "Verifying your identity grants you access to our onchain Exa Card, enabling you to easily spend your crypto.",
              )}
        </Text>
      </YStack>
      <YStack>
        <Button
          primary
          marginTop="$s4"
          marginBottom="$s5"
          loading={beginKYC.isPending}
          disabled={beginKYC.isPending}
          onPress={() => {
            if (addFunds) {
              router.push("/add-funds");
              return;
            }
            beginKYC.mutate(undefined, {
              onSuccess(result) {
                if (result.status === "complete") router.replace("/(main)/(home)");
              },
              onError(error) {
                toast.show(t("Error verifying identity"), {
                  duration: 1000,
                  burntOptions: { haptic: "error", preset: "error" },
                });
                reportError(error);
              },
            });
          }}
        >
          <Button.Text>{addFunds ? t("Add funds") : t("Begin verifying")}</Button.Text>
          <Button.Icon>{addFunds ? <ArrowDownToLine /> : <IdCard />}</Button.Icon>
        </Button>
      </YStack>
    </YStack>
  );
}
