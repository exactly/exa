import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { ArrowLeft, ArrowRight, Check, CircleHelp, ClipboardPaste, TriangleAlert } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { getStringAsync } from "expo-clipboard";
import { useNavigation } from "expo-router";
import React, { useEffect, useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, Separator, XStack, YStack } from "tamagui";
import { parse } from "valibot";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Receiver() {
  const navigation = useNavigation<AppNavigationProperties>();
  const toast = useToastController();
  const { presentArticle } = useIntercom();
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const { market } = useAsset(loan?.market);
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);

  const [receiverType, setReceiverType] = useState<"internal" | "external">("internal");

  const form = useForm({
    defaultValues: { receiver: address ?? "" },
    onSubmit: ({ value }) => {
      try {
        const receiver = parse(Address, value.receiver);
        queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, receiver }));
        navigation.navigate("loan", { screen: "review" });
      } catch {
        toast.show("Invalid address", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
      }
    },
  });

  const receiver = useStore(form.store, (state) => state.values.receiver);
  const isValid = useStore(form.store, (state) => state.isValid);

  const displayInput = receiverType === "external";
  useEffect(() => {
    return () => {
      queryClient.setQueryData<Loan>(["loan"], (old) => {
        return { ...old, receiver: undefined };
      });
    };
  }, []);
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, receiver: undefined }));
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.replace("loan", { screen: "installments" });
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
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s6">
            <YStack gap="$s4_5">
              <Text primary emphasized body>
                Select where to receive the funding
              </Text>
              <YStack gap="$s3">
                <XStack
                  backgroundColor={receiverType === "internal" ? "$interactiveBaseBrandSoftDefault" : "$backgroundSoft"}
                  onPress={() => {
                    setReceiverType("internal");
                    form.setFieldValue("receiver", address ?? "");
                    form.validateAllFields("change").catch(reportError);
                  }}
                  minHeight={72}
                  borderRadius="$r4"
                  alignItems="center"
                  padding="$s4"
                  flex={1}
                  gap="$s4"
                  cursor="pointer"
                >
                  <XStack
                    backgroundColor={receiverType === "internal" ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                    width={20}
                    height={20}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                  >
                    {receiverType === "internal" && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                  </XStack>
                  <YStack gap={2} flex={1}>
                    <Text headline>Your Exa account</Text>
                    <Text footnote color="$uiNeutralSecondary">
                      Deposit {symbol} into your Exa App wallet
                    </Text>
                  </YStack>
                </XStack>
                <XStack
                  backgroundColor={receiverType === "external" ? "$interactiveBaseBrandSoftDefault" : "$backgroundSoft"}
                  onPress={() => {
                    setReceiverType("external");
                    form.setFieldValue("receiver", "");
                  }}
                  minHeight={72}
                  borderRadius="$r4"
                  alignItems="center"
                  padding="$s4"
                  flex={1}
                  gap="$s4"
                  cursor="pointer"
                >
                  <XStack
                    backgroundColor={receiverType === "external" ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                    width={20}
                    height={20}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                  >
                    {receiverType === "external" && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                  </XStack>
                  <YStack gap={2} flex={1}>
                    <Text headline>External address on {chain.name}</Text>
                    <Text footnote color="$uiNeutralSecondary">
                      Deposit {symbol} directly to an external wallet
                    </Text>
                  </YStack>
                </XStack>
                {displayInput && (
                  <form.Field name="receiver" validators={{ onChange: Address }}>
                    {({ state: { value }, handleChange, setValue }) => {
                      return (
                        <XStack alignItems="center">
                          <Input
                            neutral
                            flex={1}
                            placeholder="Enter receiver address"
                            borderColor="$uiNeutralTertiary"
                            borderRightColor="transparent"
                            borderTopRightRadius={0}
                            borderBottomRightRadius={0}
                            value={value}
                            onChangeText={handleChange}
                          />
                          <Button
                            outlined
                            borderColor="$uiNeutralTertiary"
                            borderRadius="$r3"
                            borderTopLeftRadius={0}
                            borderBottomLeftRadius={0}
                            borderLeftWidth={0}
                            minHeight={44}
                            height={44}
                            onPress={() => {
                              getStringAsync()
                                .then((text) => {
                                  setValue(text);
                                })
                                .catch(reportError);
                            }}
                          >
                            <Button.Icon>
                              <ClipboardPaste size={24} />
                            </Button.Icon>
                          </Button>
                        </XStack>
                      );
                    }}
                  </form.Field>
                )}
              </YStack>
            </YStack>
          </YStack>
          <YStack gap="$s4_5">
            {displayInput && (
              <YStack gap="$s4_5">
                <Separator borderColor="$borderNeutralSoft" />
                <XStack gap="$s3" alignItems="center">
                  <TriangleAlert size={16} color="$uiWarningSecondary" />
                  <Text caption2 color="$uiNeutralPlaceholder" flex={1}>
                    Send funds only to {chain.name} addresses. Sending assets to any other network will cause
                    irreversible loss of funds. Arrival time ≈ 5 min.
                    <Text
                      caption2
                      emphasized
                      color="$uiBrandSecondary"
                      cursor="pointer"
                      onPress={() => {
                        presentArticle("9056481").catch(reportError);
                      }}
                    >
                      &nbsp;Learn more about sending funds.
                    </Text>
                  </Text>
                </XStack>
              </YStack>
            )}
            <form.Subscribe>
              {() => {
                const disabled = !receiver || !isValid;
                return (
                  <Button
                    primary
                    onPress={() => {
                      form.handleSubmit().catch(reportError);
                    }}
                    disabled={disabled}
                  >
                    <Button.Text>Review loan terms</Button.Text>
                    <Button.Icon>
                      <ArrowRight />
                    </Button.Icon>
                  </Button>
                );
              }}
            </form.Subscribe>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
