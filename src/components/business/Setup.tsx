import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable } from "react-native";

import { useRouter } from "expo-router";

import { toast } from "@tamagui/toast";
import { ScrollView, XStack, YStack } from "tamagui";

import { useIsMutating, useMutation } from "@tanstack/react-query";

import Handoff from "./Handoff";
import Question from "./Question";
import Row from "./Row";
import Tag from "./Tag";
import Task from "./Task";
import { ArrowLeft } from "../../generated/icons/ArrowLeft";
import { ChevronRight } from "../../generated/icons/ChevronRight";
import { CircleCheck } from "../../generated/icons/CircleCheck";
import { CircleX } from "../../generated/icons/CircleX";
import { Clock } from "../../generated/icons/Clock";
import { CreditCard } from "../../generated/icons/CreditCard";
import { Landmark } from "../../generated/icons/Landmark";
import { X } from "../../generated/icons/X";
import { present } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import { startBusinessKYC } from "../../utils/persona";
import queryClient, { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { startApplication, startRampOnboarding } from "../../utils/server";
import useBusiness, { kybLink } from "../../utils/useBusiness";
import RampWebView from "../add-funds/RampWebView";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

import type { Step } from "../../utils/useBusiness";

export default function Setup() {
  const { t } = useTranslation();
  const router = useRouter();
  const [terms, setTerms] = useState<string>();
  const [handoff, setHandoff] = useState<string>();
  const {
    profile,
    card: cardStep,
    cardLink,
    approved,
    locked,
    redirectURL,
    requirement,
    refetchTransfers,
    transfers: transfersStep,
    tosLink,
    kycLink,
  } = useBusiness(true);
  const blocked = locked && profile !== undefined;
  const card = blocked ? "pending" : cardStep;
  const transfers = blocked ? "pending" : transfersStep;
  const onboarding = useIsMutating({ mutationKey: ["ramp", "onboarding"] }) > 0;
  function close() {
    setTerms(undefined);
  }
  function fail(error: Error) {
    setTerms(undefined);
    if (error instanceof APIError && error.code === 400) {
      switch (error.text) {
        case "already onboarded":
          queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
          return;
        case "bad kyb":
        case "bad kyc":
        case "not started":
        case "processing":
          queryClient.invalidateQueries({ queryKey: ["kyc", "status"], exact: true }).catch(reportError);
          queryClient.invalidateQueries({ queryKey: ["kyc", "panda-business"], exact: true }).catch(reportError);
          return;
        case "email already exists":
          toast.error(t("This email is already registered for transfers. Contact support to continue."), {
            duration: 3000,
          });
          reportError(error, { level: "warning" });
          return;
        case "not supported":
        case "not supported chain id":
          toast.error(t("Transfers aren't available for your business yet."), { duration: 3000 });
          reportError(error, { level: "warning" });
          return;
        case "bad request":
          toast.error(t("We couldn't verify your business details. Contact support to continue."), { duration: 3000 });
          reportError(error);
          return;
      }
    }
    toast.error(t("An error occurred. Please try again later."), { duration: 1000 });
    reportError(error);
  }
  const application = useMutation({
    mutationKey: ["kyc", "panda-business"],
    async mutationFn() {
      const data = await startApplication();
      if (data.type !== "persona") return kybLink(data);
      const { status } = await startBusinessKYC(data);
      if (status === "error") toast.error(t("An error occurred. Please try again later."), { duration: 1000 });
    },
    onSuccess: (uri) => {
      if (uri) setHandoff(uri);
      queryClient.invalidateQueries({ queryKey: ["kyc", "panda-business"] }).catch(reportError);
    },
    onError: fail,
  });
  const { mutate: onboard } = useMutation({
    mutationKey: ["ramp", "onboarding"],
    mutationFn: (acceptedTermsId: string) => startRampOnboarding({ provider: "bridge", acceptedTermsId }),
    onSuccess: async () => {
      setTerms(undefined);
      const { data } = await refetchTransfers();
      const uri = data?.bridge.status === "ONBOARDING" && "kycLink" in data.bridge ? data.bridge.kycLink : undefined;
      if (uri) verify(uri);
    },
    onError: fail,
  });
  if (terms) {
    return (
      <SafeView fullScreen backgroundColor="backgroundSoft">
        <XStack padding="s4">
          <IconButton icon={X} aria-label={t("Close")} onPress={close} />
        </XStack>
        <RampWebView
          key={terms}
          uri={terms}
          redirectURL={redirectURL}
          onRedirect={(url) => {
            const acceptedTermsId = new URL(url).searchParams.get("signed_agreement_id");
            if (!acceptedTermsId) {
              fail(new Error("missing signed agreement"));
              return;
            }
            if (!onboarding) onboard(acceptedTermsId);
          }}
          onError={() => {
            fail(new Error("verification webview error"));
          }}
        />
      </SafeView>
    );
  }
  return (
    <SafeView fullScreen backgroundColor="backgroundSoft" paddingBottom="s0">
      <ScrollView flex={1} showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
        <YStack flexGrow={1} padding="s4" paddingBottom="s6" gap="s6">
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
          <YStack gap="s4_5">
            <Text emphasized title3 primary>
              {t("Set up your business account")}
            </Text>
            <Text subHeadline secondary>
              {t("A few more details about your business and you're ready to spend and transfer.")}
            </Text>
          </YStack>
          <YStack gap="s3_5">
            {(card === undefined || card === "pending" || card === "action") && (
              <Task
                disabled={card === undefined}
                icon={<CreditCard size={20} color="uiBrandSecondary" />}
                tag={card === "action" ? <Tag label={t("Action needed")} variant="error" /> : undefined}
                title={t("Get an Exa Card for your business")}
                description={
                  card === "action"
                    ? t("We need more information before we can continue.")
                    : requirement === "terms"
                      ? t("Your business is approved. Accept the terms to continue.")
                      : requirement === "representative"
                        ? t("Add the details of the person who will use the card.")
                        : t("Verify your business to get a Visa Business Exa Card.")
                }
                action={
                  card === "action"
                    ? t("Continue verification")
                    : requirement === "terms"
                      ? t("Accept terms")
                      : requirement === "representative"
                        ? t("Add card user")
                        : t("Start verification")
                }
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
            {(transfers === undefined || transfers === "pending" || transfers === "action") && (
              <Task
                disabled={transfers === undefined}
                icon={<Landmark size={20} color="uiBrandSecondary" />}
                tag={transfers === "action" ? <Tag label={t("Action needed")} variant="error" /> : undefined}
                title={t("Enable USD and EUR transfers")}
                description={
                  transfers === "action"
                    ? t("We need more information before we can continue.")
                    : t("Get USD and EUR account details to transfer funds in and out of your Exa Account.")
                }
                action={transfers === "action" ? t("Continue verification") : t("Start verification")}
                loading={onboarding}
                onPress={
                  locked
                    ? undefined
                    : () => {
                        if (onboarding) return;
                        if (kycLink) verify(kycLink);
                        else if (tosLink) setTerms(tosLink);
                      }
                }
              />
            )}
          </YStack>
          <YStack gap="s4">
            {[
              {
                step: card,
                title: t("Exa Card for your business"),
                review: approved
                  ? t("We’re reviewing the card user. Your card will be issued once approved.")
                  : undefined,
              },
              { step: transfers, title: t("USD and EUR transfers") },
              { step: profile, title: t("Business profile"), loading: true },
            ]
              .filter(({ step, loading }) => (step !== undefined || loading) && step !== "pending" && step !== "action")
              .map(({ step, title, review }, index) => (
                <React.Fragment key={title}>
                  {index > 0 && <YStack height={1} backgroundColor="borderNeutralSoft" />}
                  <Progress step={step} title={title} review={review} />
                </React.Fragment>
              ))}
          </YStack>
        </YStack>
        <YStack
          backgroundColor="backgroundMild"
          borderTopWidth={1}
          borderTopColor="borderNeutralSoft"
          paddingHorizontal="s4"
          paddingVertical="s5"
          gap="s5"
        >
          <Text emphasized headline primary>
            {t("Frequently asked questions")}
          </Text>
          <YStack gap="s4">
            {[
              {
                question: t("Which documents do I need to verify my business?"),
                answer: t(
                  "Have ready your company’s formation document (such as the certificate of incorporation), a document showing who owns 25% or more (shareholder register, operating agreement or signed cap table), proof of your business address from the last 90 days, and your company’s tax ID. Each owner with 25% or more also completes an ID check with a selfie.",
                ),
              },
              {
                question: t("How do I get an Exa Business Card?"),
                answer: t(
                  "Tap “Get an Exa Card for your business” and verify your company. Once it’s approved, accept the card terms and add the name and email of the person who will use the card. After a short review of that person, the card is issued in the app.",
                ),
              },
              {
                question: t("What types of accounts can I open?"),
                answer: t(
                  "Two virtual accounts: one in USD (account and routing number) for ACH and wires, and one in EUR (IBAN) for SEPA. Money you receive is converted to USDC in your Exa account, and you can withdraw to your company’s bank account in USD or EUR.",
                ),
              },
              {
                question: t("How long does verification take?"),
                answer: t(
                  "Usually 3 to 5 business days once you’ve submitted everything. The card and the USD/EUR transfers are reviewed separately, so one can be approved before the other.",
                ),
              },
            ].map(({ question, answer }, index) => (
              <React.Fragment key={question}>
                {index > 0 && <YStack height={1} backgroundColor="borderNeutralSoft" />}
                <Question question={question} answer={answer} />
              </React.Fragment>
            ))}
          </YStack>
          <Pressable
            role="button"
            hitSlop={15}
            onPress={() => {
              present().catch(reportError);
            }}
          >
            <XStack alignSelf="center" alignItems="center" gap="s2">
              <Text emphasized footnote color="interactiveBaseBrandDefault">
                {t("Help center")}
              </Text>
              <ChevronRight size={16} color="interactiveBaseBrandDefault" />
            </XStack>
          </Pressable>
        </YStack>
      </ScrollView>
      <Handoff
        open={!!handoff}
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

function verify(uri: string) {
  if (!uri.startsWith("https://")) {
    reportError(new Error("unsupported verification link"));
    return;
  }
  if (Platform.OS === "web") window.location.assign(uri);
  else openBrowser(uri).catch(reportError);
}

function Progress({ step, title, review }: { review?: string; step?: Step; title: string }) {
  const { t } = useTranslation();
  switch (step) {
    case undefined:
      return <Row disabled icon={<Clock size={20} color="uiNeutralSecondary" />} title={title} />;
    case "review":
      return (
        <Row
          icon={<Clock size={20} color="uiWarningSecondary" />}
          title={title}
          description={review ?? t("Review takes 3 to 5 business days.")}
          tag={<Tag label={t("In review")} variant="warning" />}
        />
      );
    case "completed":
      return (
        <Row
          icon={<CircleCheck size={20} color="uiSuccessSecondary" />}
          title={title}
          tag={<Tag label={t("Complete")} variant="success" />}
        />
      );
    case "failed":
    case "unavailable":
      return (
        <Row
          icon={<CircleX size={20} color="uiErrorSecondary" />}
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
