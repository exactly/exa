import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { MATURITY_INTERVAL } from "@exactly/lib";
import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";

import LoanSummary from "./LoanSummary";
import { presentArticle } from "../../utils/intercom";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Maturity() {
  const router = useRouter();
  const { t } = useTranslation();
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const timestamp = Math.floor(Date.now() / 1000);
  const firstMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;

  const disabled = !loan?.maturity;

  useEffect(() => {
    return () => {
      queryClient.setQueryData<Loan>(["loan"], (old) => {
        return { ...old, maturity: undefined, receiver: undefined };
      });
    };
  }, []);
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, maturity: undefined }));
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/loan");
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
        <Pressable
          onPress={() => {
            presentArticle("11541409").catch(reportError);
          }}
        >
          <CircleHelp color="$uiNeutralPrimary" />
        </Pressable>
      </View>
      <ScrollView
        backgroundColor="$backgroundMild"
        showsVerticalScrollIndicator={false}
        // eslint-disable-next-line react-native/no-inline-styles
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack gap="$s4" justifyContent="space-between">
          <YStack gap="$s4" padding="$s4">
            <YStack gap="$s4_5">
              <YStack gap="$s4_5">
                <Text primary emphasized body>
                  Select first due date
                </Text>
                <YStack gap="$s3">
                  {Array.from({ length: MAX_INSTALLMENTS }).map((_, index) => {
                    const maturity = firstMaturity + index * MATURITY_INTERVAL;
                    const selected = maturity === Number(loan?.maturity);
                    const invalid = index + Number(loan?.installments) > MAX_INSTALLMENTS;
                    return (
                      <XStack
                        key={index}
                        onPress={() => {
                          if (invalid) return;
                          queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, maturity }));
                        }}
                        flex={1}
                        gap="$s4"
                        minHeight={60}
                        backgroundColor={
                          selected
                            ? "$interactiveBaseBrandSoftDefault"
                            : invalid
                              ? "$interactiveDisabled"
                              : "$backgroundSoft"
                        }
                        borderRadius="$r4"
                        alignItems="center"
                        padding="$s4"
                        paddingVertical="$s4_5"
                        cursor={invalid ? "not-allowed" : "pointer"}
                      >
                        <XStack
                          backgroundColor={selected ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                          width={20}
                          height={20}
                          borderRadius={12}
                          alignItems="center"
                          justifyContent="center"
                        >
                          {selected && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                        </XStack>
                        <YStack>
                          <Text headline color={invalid ? "$interactiveOnDisabled" : "$uiNeutralPrimary"}>
                            {format(new Date(maturity * 1000), "MMM dd, yyyy")}
                          </Text>
                          {invalid ? (
                            <Text footnote color="$uiNeutralPlaceholder">
                              {t("Available for {{count}} installments or less", { count: MAX_INSTALLMENTS - index })}
                            </Text>
                          ) : null}
                        </YStack>
                      </XStack>
                    );
                  })}
                </YStack>
              </YStack>
            </YStack>
          </YStack>
        </YStack>
      </ScrollView>
      <YStack gap="$s4" padding="$s4" backgroundColor="$backgroundSoft">
        {loan && <LoanSummary loan={loan} />}
        <Button
          onPress={() => {
            router.push("/loan/receiver");
          }}
          primary
          disabled={disabled}
        >
          <Button.Text>Continue</Button.Text>
          <Button.Icon>
            <ArrowRight />
          </Button.Icon>
        </Button>
      </YStack>
    </SafeView>
  );
}
