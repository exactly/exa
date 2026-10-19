import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, ChevronRight, CircleCheck, CircleX, Clock, CreditCard, Landmark, X } from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import Handoff from "./Handoff";
import Question from "./Question";
import Row from "./Row";
import Tag from "./Tag";
import Task from "./Task";
import { present } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import { startBridgeKYB, startBusinessKYC } from "../../utils/persona";
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
  const [handoff, setHandoff] = useState<string>();
  const { profile, card, cardLink, locked, redirectURL, refetchTransfers, transfers, tosLink, kycLink } =
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
    async mutationFn() {
      let previous: string | undefined;
      for (;;) {
        const result = await startApplication();
        if (result.type !== "persona") return result;
        if (result.inquiryId === previous) return;
        previous = result.inquiryId;
        const { status } = await startBusinessKYC(result);
        if (status !== "complete") return;
      }
    },
    onSuccess: (data) => {
      const uri = kybLink(data);
      if (uri) setHandoff(uri);
      queryClient.invalidateQueries({ queryKey: ["kyc", "panda-business"] }).catch(reportError);
    },
    onError: fail,
  });
  const kyb = useMutation({
    mutationKey: ["ramp", "kyb"],
    mutationFn: startBridgeKYB,
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
    },
    onError: fail,
  });
  const onboarding = useMutation({
    mutationKey: ["ramp", "onboarding"],
    mutationFn: (acceptedTermsId: string) => startRampOnboarding({ provider: "bridge", acceptedTermsId }),
    onSuccess: async () => {
      const { data } = await refetchTransfers();
      const uri = data?.bridge.status === "ONBOARDING" && "kycLink" in data.bridge ? data.bridge.kycLink : undefined;
      if (!uri) {
        close();
        return;
      }
      setVerification(undefined);
      kyb.mutate(uri);
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
          key={verification.uri}
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
      <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <YStack flexGrow={1} padding="$s4" paddingBottom="$s6" gap="$s6">
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
          <YStack gap="$s4_5">
            <Text emphasized title3 primary>
              {t("Set up your business account")}
            </Text>
            <Text subHeadline secondary>
              {t("A few more details about your business and you're ready to spend and transfer.")}
            </Text>
          </YStack>
          <YStack gap="$s3_5">
            {card === undefined && <Skeleton width="100%" height={140} radius={8} />}
            {(card === "pending" || card === "action") && (
              <Task
                icon={<CreditCard size={20} color="$uiBrandSecondary" />}
                tag={card === "action" ? <Tag label={t("Action needed")} variant="error" /> : undefined}
                title={t("Get an Exa Card for your business")}
                description={
                  card === "action"
                    ? t("We need more information before we can continue.")
                    : t("Verify your business to get a Visa Signature Business Exa Card.")
                }
                action={card === "action" ? t("Continue verification") : t("Start verification")}
                loading={application.isPending}
                onPress={
                  locked
                    ? undefined
                    : () => {
                        if (application.isPending) return;
                        if (cardLink) setHandoff(cardLink);
                        else application.mutate();
                      }
                }
              />
            )}
            {transfers === undefined && <Skeleton width="100%" height={140} radius={8} />}
            {(transfers === "pending" || transfers === "action") && (
              <Task
                icon={<Landmark size={20} color="$uiBrandSecondary" />}
                tag={transfers === "action" ? <Tag label={t("Action needed")} variant="error" /> : undefined}
                title={t("Enable USD and EUR transfers")}
                description={
                  transfers === "action"
                    ? t("We need more information before we can continue.")
                    : t("Get USD and EUR account details to transfer funds in and out of your Exa Account.")
                }
                action={transfers === "action" ? t("Continue verification") : t("Start verification")}
                loading={onboarding.isPending || kyb.isPending}
                onPress={
                  locked
                    ? undefined
                    : () => {
                        if (onboarding.isPending || kyb.isPending) return;
                        if (kycLink) kyb.mutate(kycLink);
                        else if (tosLink) setVerification({ uri: tosLink, terms: true });
                      }
                }
              />
            )}
          </YStack>
          <YStack gap="$s4">
            {[
              { step: card, title: t("Exa Card for your business") },
              { step: transfers, title: t("USD and EUR transfers") },
              { step: profile, title: t("Business profile") },
            ]
              .filter(({ step }) => step !== "pending" && step !== "action")
              .map(({ step, title }, index) => (
                <React.Fragment key={title}>
                  {index > 0 && <YStack height={1} backgroundColor="$borderNeutralSoft" />}
                  <Progress step={step} title={title} />
                </React.Fragment>
              ))}
          </YStack>
        </YStack>
        <YStack
          backgroundColor="$backgroundMild"
          borderTopWidth={1}
          borderTopColor="$borderNeutralSoft"
          paddingHorizontal="$s4"
          paddingVertical="$s5"
          gap="$s5"
        >
          <Text emphasized headline primary>
            {t("Frequently asked questions")}
          </Text>
          <YStack gap="$s4">
            {[
              t("Which documents do I need to verify my business?"),
              t("How do I get a Visa Signature Business Exa Card?"),
              t("What types of accounts can I open?"),
              t("How long does verification take?"),
            ].map((question, index) => (
              <React.Fragment key={question}>
                {index > 0 && <YStack height={1} backgroundColor="$borderNeutralSoft" />}
                <Question
                  question={question}
                  answer={t("Get virtual accounts to transfer money in and out of your Exa Account.")}
                />
              </React.Fragment>
            ))}
          </YStack>
          <Pressable
            hitSlop={15}
            onPress={() => {
              present().catch(reportError);
            }}
          >
            <XStack alignSelf="center" alignItems="center" gap="$s2">
              <Text emphasized footnote color="$interactiveBaseBrandDefault">
                {t("Help center")}
              </Text>
              <ChevronRight size={16} color="$interactiveBaseBrandDefault" />
            </XStack>
          </Pressable>
        </YStack>
      </ScrollView>
      <Handoff
        open={!!handoff}
        provider="Rain"
        onClose={() => {
          setHandoff(undefined);
        }}
        onContinue={() => {
          if (handoff) openBrowser(handoff).catch(reportError);
          setHandoff(undefined);
        }}
      />
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
    case "unavailable":
      return (
        <Row
          icon={<CircleX size={20} color="$uiErrorSecondary" />}
          title={title}
          description={t("Contact support to continue.")}
          tag={<Tag label={step === "failed" ? t("Failed") : t("Not available")} variant="error" />}
          onPress={() => {
            present().catch(reportError);
          }}
        />
      );
    default:
      return null;
  }
}
