import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { MATURITY_INTERVAL } from "@exactly/lib";
import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { useAccount } from "wagmi";

import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Maturity() {
  const { canGoBack } = router;
  const { t } = useTranslation();
  const { presentArticle } = useIntercom();
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const timestamp = Math.floor(Date.now() / 1000);
  const firstMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  const disabled = !loan?.maturity;
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, maturity: undefined }));
            if (canGoBack()) {
              router.back();
              return;
            }
            router.replace("/");
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
        <Text primary emphasized subHeadline>
          Estimate loan terms
        </Text>
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
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s4">
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
                        minHeight={72}
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
                        flex={1}
                        gap="$s4"
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
                        <YStack gap="$s2">
                          <Text headline color={invalid ? "$interactiveOnDisabled" : "$uiNeutralPrimary"}>
                            {format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}
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
              {loan?.maturity ? (
                loan.installments > 1 ? (
                  <Text footnote color="$uiNeutralPlaceholder">
                    First payment is due {format(new Date(Number(loan.maturity) * 1000), "MMM dd, yyyy")}. The remaining
                    installments will follow every 28 days.
                  </Text>
                ) : (
                  <Text footnote color="$uiNeutralPlaceholder">
                    The installment is due {format(new Date(Number(loan.maturity) * 1000), "MMM dd, yyyy")}
                  </Text>
                )
              ) : null}
            </YStack>
          </YStack>
          <YStack>
            <Button
              onPress={() => {
                router.push("/(app)/loan/receiver");
              }}
              main
              spaced
              outlined
              disabled={disabled}
              backgroundColor={disabled ? "$interactiveDisabled" : "$interactiveBaseBrandSoftDefault"}
              color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
              iconAfter={
                <ArrowRight
                  color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandSoft"}
                  strokeWidth={2.5}
                />
              }
              flex={0}
            >
              Continue
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
