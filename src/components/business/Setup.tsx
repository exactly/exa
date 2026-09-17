import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, ChevronRight, CircleCheck, CircleX, Clock, CreditCard, Landmark, X } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import Question from "./Question";
import Row from "./Row";
import Tag from "./Tag";
import Task from "./Task";
import { present } from "../../utils/intercom";
import queryClient, { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { startApplication, startRampOnboarding } from "../../utils/server";
import useBusiness, { kybLink } from "../../utils/useBusiness";
import RampWebView from "../add-funds/RampWebView";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

import type { Step } from "../../utils/useBusiness";

export default function Setup() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const [verification, setVerification] = useState<{ terms?: boolean; uri: string }>();
  const { profile, card, cardLink, locked, reason, redirectURL, refetchTransfers, transfers, tosLink, kycLink } =
    useBusiness(true);
  function close() {
    setVerification(undefined);
    queryClient.invalidateQueries({ queryKey: ["kyc", "panda-business"] }).catch(reportError);
    queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
  }
  function fail(error: Error) {
    if (
      error instanceof APIError &&
      error.code === 400 &&
      ["already onboarded", "bad kyb", "not started", "processing"].includes(error.text)
    ) {
      close();
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      return;
    }
    setVerification(undefined);
    toast.show(t("An error occurred. Please try again later."), {
      duration: 1000,
      burntOptions: { haptic: "error", preset: "error" },
    });
    reportError(error);
  }
  const application = useMutation({
    mutationKey: ["kyc", "panda-business"],
    mutationFn: startApplication,
    onSuccess: (data) => {
      const uri = kybLink(data);
      if (uri) setVerification({ uri });
      queryClient.invalidateQueries({ queryKey: ["kyc", "panda-business"] }).catch(reportError);
    },
    onError: fail,
  });
  const onboarding = useMutation({
    mutationKey: ["ramp", "onboarding"],
    mutationFn: (acceptedTermsId: string) => startRampOnboarding({ provider: "bridge", acceptedTermsId }),
    onSuccess: async () => {
      const { data } = await refetchTransfers();
      const uri = data?.bridge.status === "ONBOARDING" && "kycLink" in data.bridge ? data.bridge.kycLink : undefined;
      if (uri) setVerification({ uri });
      else close();
    },
    onError: fail,
  });
  if (verification) {
    return (
      <SafeView fullScreen backgroundColor="$backgroundSoft">
        <XStack padding="$s4">
          <IconButton icon={X} aria-label={t("Close")} onPress={close} />
        </XStack>
        <RampWebView
          uri={verification.uri}
          redirectURL={redirectURL}
          onRedirect={(url) => {
            if (!verification.terms) {
              close();
              return;
            }
            const acceptedTermsId = new URL(url).searchParams.get("signed_agreement_id");
            if (!acceptedTermsId) {
              fail(new Error("missing signed agreement"));
              return;
            }
            onboarding.mutate(acceptedTermsId);
          }}
          onError={() => {
            fail(new Error("verification webview error"));
          }}
        />
      </SafeView>
    );
  }
  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft" paddingBottom={0}>
      <ScrollView flex={1} showsVerticalScrollIndicator={false}>
        <YStack padding="$s4" paddingBottom="$s6" gap="$s6">
          <XStack>
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) router.back();
                else router.replace("/(main)/(home)");
              }}
            />
          </XStack>
          <YStack gap="$s3">
            <Text emphasized title3 primary>
              {t("Set up your business account")}
            </Text>
            <Text subHeadline secondary>
              {t("A few more details about your business and you're ready to spend and transfer.")}
            </Text>
          </YStack>
          <YStack gap="$s4">
            {(card === "pending" || card === "action") && (
              <Task
                icon={<CreditCard size={20} color="$uiBrandSecondary" />}
                tag={card === "action" && <Tag label={t("Action needed")} variant="error" />}
                title={t("Get an Exa Card for your business")}
                description={
                  card === "action"
                    ? (reason ?? t("We need more information before we can continue."))
                    : t("Verify your business to get a Visa Signature Business Exa Card.")
                }
                action={card === "action" ? t("Continue verification") : t("Start verification")}
                onPress={
                  locked
                    ? undefined
                    : () => {
                        if (application.isPending) return;
                        if (cardLink) setVerification({ uri: cardLink });
                        else application.mutate();
                      }
                }
              />
            )}
            {(transfers === "pending" || transfers === "action") && (
              <Task
                icon={<Landmark size={20} color="$uiBrandSecondary" />}
                tag={transfers === "action" && <Tag label={t("Action needed")} variant="error" />}
                title={t("Enable USD and EUR transfers")}
                description={
                  transfers === "action"
                    ? t("We need more information before we can continue.")
                    : t("Get USD and EUR account details to transfer funds in and out of your Exa Account.")
                }
                action={transfers === "action" ? t("Continue verification") : t("Start verification")}
                onPress={
                  locked
                    ? undefined
                    : () => {
                        if (onboarding.isPending) return;
                        if (kycLink) setVerification({ uri: kycLink });
                        else if (tosLink) setVerification({ uri: tosLink, terms: true });
                      }
                }
              />
            )}
          </YStack>
          <YStack>
            <Progress step={card} title={t("Exa Card for your business")} />
            <Progress step={transfers} title={t("USD and EUR transfers")} />
            <Progress step={profile} title={t("Business profile")} />
          </YStack>
        </YStack>
        <YStack
          backgroundColor="$backgroundMild"
          borderTopWidth={1}
          borderTopColor="$borderNeutralSoft"
          padding="$s4"
          paddingTop="$s6"
          gap="$s4"
        >
          <Text emphasized headline primary>
            {t("Frequently asked questions")}
          </Text>
          <YStack>
            <Question
              question={t("Which documents do I need to verify my business?")}
              answer={t("Get virtual accounts to transfer money in and out of your Exa Account.")}
            />
            <Question
              question={t("How do I get a Visa Signature Business Exa Card?")}
              answer={t("Get virtual accounts to transfer money in and out of your Exa Account.")}
            />
            <Question
              question={t("What types of accounts can I open?")}
              answer={t("Get virtual accounts to transfer money in and out of your Exa Account.")}
            />
            <Question
              question={t("How long does verification take?")}
              answer={t("Get virtual accounts to transfer money in and out of your Exa Account.")}
            />
          </YStack>
          <Pressable
            hitSlop={15}
            onPress={() => {
              present().catch(reportError);
            }}
          >
            <XStack alignSelf="center" alignItems="center" gap="$s2" paddingVertical="$s4">
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                {t("Help center")}
              </Text>
              <ChevronRight size={16} color="$interactiveBaseBrandDefault" />
            </XStack>
          </Pressable>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}

function Progress({ step, title }: { step?: Step; title: string }) {
  const { t } = useTranslation();
  switch (step) {
    case undefined:
      return <Skeleton width="100%" height={56} radius={8} />;
    case "review":
      return (
        <Row
          icon={<Clock size={20} color="$uiWarningSecondary" />}
          title={title}
          description={t("Review takes 3 to 5 business days.")}
          tag={<Tag label={t("In review")} variant="warning" />}
        />
      );
    case "completed":
      return (
        <Row
          icon={<CircleCheck size={20} color="$uiSuccessSecondary" />}
          title={title}
          tag={<Tag label={t("Complete")} variant="success" />}
        />
      );
    case "failed":
      return (
        <Row
          icon={<CircleX size={20} color="$uiErrorSecondary" />}
          title={title}
          description={t("Contact support to continue.")}
          tag={<Tag label={t("Failed")} variant="error" />}
          onPress={() => {
            present().catch(reportError);
          }}
        />
      );
    default:
      return null;
  }
}
