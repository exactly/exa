import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, TextInput } from "react-native";
import Svg, { Line } from "react-native-svg";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowRight, CircleCheck, CreditCard, FileChartColumn, Link, ReceiptText } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Spinner, useTheme, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";

import Isotype from "../../assets/images/isotype.svg"; // cspell:ignore isotype
import WhatsAppLogo from "../../assets/images/whatsapp.svg";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import { APIError, associateChat, preflightChat, sendChatCode } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Whatsapp() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const { token } = useLocalSearchParams();
  const value = typeof token === "string" ? token : undefined;

  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [resendAt, setResendAt] = useState(0);

  const preflight = useQuery({
    queryKey: ["chat", "preflight", value],
    queryFn: () => {
      if (!value) throw new Error("missing token");
      return preflightChat(value);
    },
    enabled: !!value,
    retry: false,
  });

  const sendCode = useMutation({
    mutationFn: () => {
      if (!value) throw new Error("missing token");
      return sendChatCode(value);
    },
    onSuccess: () => {
      setSent(true);
      setResendAt(Date.now() + 60_000);
    },
    onError: (error) => {
      if (error instanceof APIError && error.code === 429) {
        setSent(true);
        setResendAt(Date.now() + 60_000);
        return;
      }
      if (error instanceof APIError && error.text === "bad token") {
        toast.show(t("This link has expired. Request a new one from WhatsApp."), {
          duration: 3000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      reportError(error);
      toast.show(t("Couldn't send the code. Please try again."), {
        duration: 3000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const associate = useMutation({
    mutationFn: () => associateChat(code),
    onError: (error) => {
      if (error instanceof APIError && (error.text === "bad code" || error.text === "no verification")) return;
      reportError(error);
    },
  });

  const failure = associate.error
    ? associate.error instanceof APIError && associate.error.text === "bad code"
      ? t("That code isn't correct. Check it and try again.")
      : associate.error instanceof APIError && associate.error.text === "no verification"
        ? t("That code has expired. Send a new one.")
        : t("We couldn't verify this code. Try again in a moment.")
    : undefined;

  let content: React.ReactNode;
  let footer: React.ReactNode;
  if (!value) {
    content = (
      <Section>
        <Pill />
        <Copy
          title={t("Invalid link")}
          body={t("This link is missing its verification token. Request a new one from WhatsApp.")}
        />
      </Section>
    );
    footer = <OpenWhatsapp />;
  } else if (associate.isSuccess) {
    content = (
      <Section>
        <Pill success />
        <Copy
          title={t("WhatsApp is now linked")}
          body={t("Open WhatsApp and start chatting to manage your Exa Account.")}
        />
      </Section>
    );
    footer = <OpenWhatsapp />;
  } else if (sent) {
    content = (
      <Section>
        <Pill />
        <YStack gap="$s6" alignItems="center" width="100%">
          <Copy title={t("Enter your code")} body={t("We sent a 6-digit code to your WhatsApp.")} />
          <YStack gap="$s4_5" alignItems="center">
            <Code
              value={code}
              error={!!failure}
              onChange={(text) => {
                setCode(text);
                if (associate.isError) associate.reset();
              }}
            />
            {failure && (
              <Text caption color="$uiErrorSecondary" textAlign="center">
                {failure}
              </Text>
            )}
          </YStack>
        </YStack>
      </Section>
    );
    footer = (
      <>
        <Button
          primary
          disabled={code.length < 6 || !!failure || associate.isPending}
          loading={associate.isPending}
          onPress={() => {
            associate.mutate();
          }}
        >
          <Button.Text>{t("Verify code")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
        <Resend
          at={resendAt}
          onPress={() => {
            if (!sendCode.isPending) sendCode.mutate();
          }}
        />
      </>
    );
  } else if (preflight.isPending) {
    content = (
      <YStack flex={1} justifyContent="center">
        <Spinner color="$interactiveBaseBrandDefault" />
      </YStack>
    );
  } else if (preflight.data?.code === "whatsapp taken" || preflight.data?.code === "whatsapp associated") {
    const taken = preflight.data.code === "whatsapp taken";
    content = (
      <Section>
        <Pill />
        <Copy
          title={
            taken ? t("This number is linked to another Exa Account") : t("This account already has a linked number")
          }
          body={
            taken
              ? t(
                  "Linking it here will disconnect it from the other account. You'll no longer be able to manage that account from WhatsApp.",
                )
              : t("Linking this WhatsApp will replace it. The current number will stop working with Exa.")
          }
        />
      </Section>
    );
    footer = (
      <>
        <Button
          primary
          disabled={sendCode.isPending}
          loading={sendCode.isPending}
          onPress={() => {
            sendCode.mutate();
          }}
        >
          <Button.Text>{taken ? t("Link to this account") : t("Replace number")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
        <Text
          emphasized
          footnote
          color="$interactiveTextBrandDefault"
          textAlign="center"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/(main)/(home)");
          }}
        >
          {t("Cancel")}
        </Text>
      </>
    );
  } else if (preflight.error) {
    const expired = preflight.error instanceof APIError && preflight.error.text === "bad token";
    content = (
      <Section>
        <Pill />
        <Copy
          title={t("Can't connect WhatsApp")}
          body={t(
            expired
              ? "This link has expired. Request a new one from WhatsApp."
              : "Couldn't connect your WhatsApp. Please try again.",
          )}
        />
      </Section>
    );
    footer = expired ? (
      <OpenWhatsapp />
    ) : (
      <Button
        primary
        disabled={preflight.isFetching}
        loading={preflight.isFetching}
        onPress={() => {
          preflight.refetch().catch(reportError);
        }}
      >
        <Button.Text>{t("Retry")}</Button.Text>
        <Button.Icon>
          <ArrowRight />
        </Button.Icon>
      </Button>
    );
  } else {
    content = (
      <Section gap="$s8">
        <Pill />
        <Text emphasized title textAlign="center" paddingHorizontal="$s6">
          {t("Manage your account from WhatsApp")}
        </Text>
        <YStack gap="$s6" paddingHorizontal="$s6" width="100%">
          <Feature
            icon={<FileChartColumn size={24} color="$uiBrandSecondary" />}
            title={t("Check your account balance")}
            body={t("Never lose sight of your portfolio and keep track of all your expenses")}
          />
          <Feature
            icon={<ReceiptText size={24} color="$uiBrandSecondary" />}
            title={t("Set your Exa Card pay mode")}
            body={t("Choose Pay Now or Pay Later, and set number of installments")}
          />
          <Feature
            icon={<CreditCard size={24} color="$uiBrandSecondary" />}
            title={t("Check your Exa Card details")}
            body={t("See your card details to make online payments quick and easy")}
          />
        </YStack>
      </Section>
    );
    footer = (
      <>
        <Button
          primary
          disabled={sendCode.isPending}
          loading={sendCode.isPending}
          onPress={() => {
            sendCode.mutate();
          }}
        >
          <Button.Text>{t("Link WhatsApp")}</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
        {/* TODO open the help article */}
        <Text emphasized footnote color="$interactiveTextBrandDefault" textAlign="center">
          {t("Learn more")}
        </Text>
      </>
    );
  }

  return (
    <SafeView fullScreen>
      <View fullScreen padded>
        <YStack flex={1} alignItems="center" paddingTop="$s7">
          {content}
        </YStack>
        {footer ? (
          <YStack gap="$s5" paddingBottom="$s4">
            {footer}
          </YStack>
        ) : null}
      </View>
    </SafeView>
  );
}

function OpenWhatsapp() {
  const { t } = useTranslation();
  return (
    <Button
      primary
      onPress={() => {
        openBrowser("https://wa.me", { external: true }).catch(reportError); // TODO append bot number
      }}
    >
      <Button.Text>{t("Open WhatsApp")}</Button.Text>
      <Button.Icon>
        <ArrowRight />
      </Button.Icon>
    </Button>
  );
}

function Section({ children, gap = "$s9" }: { children: React.ReactNode; gap?: "$s8" | "$s9" }) {
  return (
    <YStack alignItems="center" gap={gap} width="100%">
      {children}
    </YStack>
  );
}

function Pill({ success }: { success?: boolean }) {
  return (
    <XStack
      backgroundColor="$backgroundStrong"
      borderRadius="$r_0"
      paddingHorizontal="$s6"
      paddingVertical="$s4"
      gap="$s3"
      alignItems="center"
    >
      <WhatsAppLogo width={40} height={40} />
      <Connector success={success} />
      {success ? <CircleCheck size={20} color="$uiSuccessSecondary" /> : <Link size={20} color="$uiNeutralPrimary" />}
      <Connector success={success} />
      <Isotype width={40} height={40} />
    </XStack>
  );
}

function Connector({ success }: { success?: boolean }) {
  const theme = useTheme();
  return (
    <Svg width={32} height={2}>
      <Line
        x1={0}
        y1={1}
        x2={32}
        y2={1}
        stroke={success ? theme.uiSuccessSecondary.val : theme.uiNeutralPrimary.val}
        strokeWidth={success ? 1 : 2}
        strokeDasharray={success ? undefined : "4 4"}
        strokeLinecap={success ? "round" : undefined}
      />
    </Svg>
  );
}

function Copy({ body, title }: { body: string; title: string }) {
  return (
    <YStack gap="$s5" paddingHorizontal="$s6" alignItems="center">
      <Text emphasized title textAlign="center">
        {title}
      </Text>
      <Text subHeadline secondary textAlign="center">
        {body}
      </Text>
    </YStack>
  );
}

function Feature({ body, icon, title }: { body: string; icon: React.ReactNode; title: string }) {
  return (
    <XStack gap="$s4_5" alignItems="center">
      {icon}
      <YStack flex={1} gap="$s3_5">
        <Text emphasized headline>
          {title}
        </Text>
        <Text subHeadline secondary>
          {body}
        </Text>
      </YStack>
    </XStack>
  );
}

function Code({ error, onChange, value }: { error?: boolean; onChange: (code: string) => void; value: string }) {
  const { t } = useTranslation();
  const ref = useRef<TextInput>(null);
  return (
    <XStack
      gap="$s3"
      onPress={() => {
        ref.current?.focus();
      }}
    >
      {Array.from({ length: 6 }, (_, index) => (
        <View
          key={index}
          width={38}
          height={56}
          borderWidth={1}
          borderColor="$borderNeutralMild"
          borderRadius="$r3"
          alignItems="center"
          justifyContent="center"
        >
          <Text mono fontSize={30} color={error ? "$uiErrorSecondary" : "$uiNeutralPrimary"}>
            {value[index]}
          </Text>
        </View>
      ))}
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(text) => {
          onChange(text.replaceAll(/\D/g, "").slice(0, 6));
        }}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        caretHidden
        aria-label={t("Verification code")}
        style={[StyleSheet.absoluteFill, { opacity: 0 }]}
      />
    </XStack>
  );
}

function Resend({ at, onPress }: { at: number; onPress: () => void }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, []);
  const seconds = Math.ceil((at - now) / 1000);
  if (seconds > 0) {
    return (
      <Text emphasized footnote secondary textAlign="center">
        {t("Resend code in {{seconds}}s", { seconds })}
      </Text>
    );
  }
  return (
    <Text emphasized footnote color="$interactiveTextBrandDefault" textAlign="center" onPress={onPress}>
      {t("Resend code")}
    </Text>
  );
}
