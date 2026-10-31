import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowDownToLine } from "@tamagui/lucide-icons-2/icons/ArrowDownToLine";
import { ArrowLeft } from "@tamagui/lucide-icons-2/icons/ArrowLeft";
import { CreditCard } from "@tamagui/lucide-icons-2/icons/CreditCard";
import { IdCard } from "@tamagui/lucide-icons-2/icons/IdCard";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
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
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { CardDetails } from "../../utils/server";

export default function GettingStarted() {
  const { t } = useTranslation();
  const router = useRouter();
  const { address: account } = useAccount();
  const { data: bytecode } = useBytecode({ address: account, chainId: chain.id, query: { enabled: !!account } });
  const { status: kyc, error, isFetched } = useKYC();
  const steps = useOnboardingSteps({ kyc, isDeployed: !!bytecode });
  const {
    data: card,
    isPending: isCardPending,
    isError: isCardError,
  } = useQuery<CardDetails>({ queryKey: ["card", "details"], enabled: !!account && !!bytecode });
  const currentStep = steps.find(({ status }) => status === "pending");
  const loading = !currentStep && kyc === "approved" && isCardPending;
  const done = !currentStep && kyc === "approved" && (card !== undefined || isCardError);
  return (
    <SafeView
      fullScreen
      backgroundColor={done ? "$backgroundSoft" : "$backgroundBrandSoft"}
      {...(!done && { paddingBottom: 0 })}
    >
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
                    router.dismissTo("/(main)/(home)");
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
          {isFetched && !error && currentStep && <CurrentStep id={currentStep.id} approved={kyc === "approved"} />}
          <YStack
            backgroundColor="$backgroundSoft"
            paddingHorizontal="$s5"
            paddingTop="$s7"
            paddingBottom={done ? "$s5" : "$s7"}
            gap="$s6"
            flex={1}
          >
            {loading ? (
              <Skeleton height={120} width="100%" />
            ) : done ? (
              <>
                <YStack flex={1} justifyContent="center" gap="$s4">
                  <Text emphasized title3 color="$uiBrandSecondary" textAlign="center">
                    {card ? t("Your Exa Card is ready") : t("Activate your new Exa Card")}
                  </Text>
                  <Text subHeadline color="$uiNeutralSecondary" textAlign="center">
                    {card
                      ? t("All set! Start spending your onchain assets instantly with your Exa Card.")
                      : t("Almost there! Activate your Exa Card to start spending your onchain assets instantly.")}
                  </Text>
                </YStack>
                <Button
                  primary
                  onPress={() => {
                    router.dismissTo(card ? "/card" : { pathname: "/card", params: { activate: "true" } });
                  }}
                >
                  <Button.Text>{card ? t("Go to Exa Card") : t("Activate Exa Card")}</Button.Text>
                  <Button.Icon>
                    <CreditCard />
                  </Button.Icon>
                </Button>
              </>
            ) : (
              <>
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
                      title={t(title, { chain: chain.name })}
                      status={status}
                      tag={
                        status === "review"
                          ? t("IN REVIEW")
                          : status === "failed"
                            ? t("VERIFICATION FAILED")
                            : undefined
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
                              : t(
                                  "To enable the Exa Card, we need to verify your identity and that you’re 18 or older.",
                                ),
                        action: status === "failed" ? t("Contact support") : t("Learn more about KYC process"),
                        onPress: () => {
                          (status === "failed" ? present() : presentArticle("9448693")).catch(reportError);
                        },
                      })}
                      {...(id === "add-funds" && {
                        icon: <ArrowDownToLine size={20} strokeWidth={2} color="$uiBrandSecondary" />,
                        description:
                          kyc === "approved"
                            ? t("Transfer from your bank, or deposit digital assets on {{chain}}.", {
                                chain: chain.name,
                              })
                            : t(
                                "Your Exa Card only works with funds on this network. Deposits on other networks won’t count until they’re bridged.",
                              ),
                        action: t("Learn more about collateral"),
                        onPress: () => {
                          presentArticle("8950805").catch(reportError);
                        },
                      })}
                    />
                  ))}
                </YStack>
              </>
            )}
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}

function CurrentStep({ id, approved }: { approved: boolean; id: "add-funds" | "create-account" | "verify-identity" }) {
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
          {addFunds
            ? approved
              ? t("Add funds to activate your Exa Card")
              : t("Add funds on {{chain}}", { chain: chain.name })
            : t("Verify your identity")}
        </Text>
      </YStack>
      <YStack>
        <Text subHeadline color="$uiNeutralSecondary">
          {addFunds
            ? approved
              ? t(
                  "Bank transfers arrive as USDC automatically. Digital assets need to be sent on {{chain}}. Deposits on other networks won’t count until they’re bridged.",
                  { chain: chain.name },
                )
              : t(
                  "Your Exa Card only works with funds on this network. Deposits on other networks won’t count until they’re bridged.",
                )
            : t(
                "Verifying your identity grants you access to our onchain Exa Card, enabling you to easily spend your digital assets. You must be 18 or older to get the card.",
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
                if (result.status === "complete") router.dismissTo("/(main)/(home)");
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
