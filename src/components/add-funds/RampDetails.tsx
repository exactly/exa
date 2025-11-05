import { ArrowLeft, Banknote, CalendarDays, Copy, Info, Percent, Repeat, X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { getOnrampQuote, type OnRampProvider } from "../../utils/server";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RampDetails() {
  const navigation = useNavigation<AppNavigationProperties>();

  const parameters = useLocalSearchParams<{
    provider: OnRampProvider;
    currency: string;
  }>();

  const { data, isPending } = useQuery({
    queryKey: ["onramp", "quote", parameters.provider, parameters.currency],
    queryFn: () => getOnrampQuote({ provider: parameters.provider, currency: parameters.currency }),
    enabled: Boolean(parameters.provider) && Boolean(parameters.currency),
  });

  const handleClose = () => {
    navigation.replace("(home)", { screen: "index" });
  };

  const detail = data?.depositInfo[0];

  console.log("detail", detail);

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View gap={20}>
          <View flexDirection="row" gap={10} justifyContent="space-between" alignItems="center">
            <Pressable
              onPress={() => {
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.replace("add-funds", { screen: "index" });
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
            <Text fontSize={15} fontWeight="bold">
              Details
            </Text>
            <Pressable>
              <Info color="$uiNeutralPrimary" />
            </Pressable>
          </View>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap={20}>
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack gap="$s4" alignSelf="center">
                <Text emphasized title3>
                  {parameters.currency} account details
                </Text>
                <Text color="$uiNeutralPlaceholder" subHeadline>
                  Copy and share your account details to turn {parameters.currency} transfers into USDC.
                </Text>
              </YStack>

              {isPending || !detail ? (
                <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                  <Text>{isPending ? "Loading..." : "No details available"}</Text>
                </YStack>
              ) : (
                <YStack gap="$s4" backgroundColor="$backgroundSoft" padding="$s4_5" borderRadius="$r3">
                  {"beneficiaryName" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          Beneficiary name
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.beneficiaryName}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"cbu" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          {detail.displayName}
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.cbu}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"pixKey" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          {detail.displayName}
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.pixKey}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"accountNumber" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          Account number
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.accountNumber}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"iban" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          {detail.displayName}
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.iban}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"clabe" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          {detail.displayName}
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.clabe}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"depositAlias" in detail && detail.depositAlias && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          Deposit alias
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.depositAlias}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"routingNumber" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          Routing number
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.routingNumber}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"bankName" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          Bank name
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.bankName}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}

                  {"bankAddress" in detail && (
                    <XStack gap="$s3" alignItems="center" justifyContent="space-between">
                      <YStack>
                        <Text emphasized secondary footnote>
                          Bank address
                        </Text>
                        <Text emphasized secondary footnote>
                          {detail.bankAddress}
                        </Text>
                      </YStack>
                      <Copy size={24} color="$uiNeutralPrimary" />
                    </XStack>
                  )}
                </YStack>
              )}
            </YStack>
          </View>
        </ScrollView>

        <YStack gap="$s4" padding="$s4">
          <Separator height={1} borderColor="$borderNeutralSoft" />
          <YStack gap="$s1" padding="$s4_5">
            <XStack gap="$s3" alignItems="center">
              <Banknote size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                Minimum amount
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {parameters.currency} 1,500
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center">
              <CalendarDays size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                Delivery time
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {detail?.estimatedProcessingTime ?? "1 business day"}
              </Text>
            </XStack>
            {data?.quote && (
              <XStack gap="$s3" alignItems="center">
                <Repeat size={24} color="$uiNeutralPrimary" />
                <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                  Exchange rate
                </Text>
                <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                  {parameters.currency} {data.quote.buyRate} ~ US$ 1
                </Text>
              </XStack>
            )}
            <XStack gap="$s3" alignItems="center">
              <Percent size={24} color="$uiNeutralPrimary" />
              <Text emphasized secondary caption2 color="$uiNeutralPlaceholder">
                {parameters.provider === "manteca" ? "Manteca" : "Bridge"} transfer fee
              </Text>
              <Text emphasized secondary caption2 color="$uiNeutralSecondary">
                {detail?.fee ?? "0.0"}%
              </Text>
            </XStack>
          </YStack>
          <Button onPress={handleClose} primary>
            <Button.Text>Close</Button.Text>
            <Button.Icon>
              <X />
            </Button.Icon>
          </Button>
        </YStack>
      </View>
    </SafeView>
  );
}
