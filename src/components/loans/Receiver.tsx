import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { ArrowLeft, ArrowRight, Check, CircleHelp, ClipboardPaste } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { getStringAsync } from "expo-clipboard";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable } from "react-native";
import { ButtonIcon, ScrollView, XStack, YStack } from "tamagui";
import { parse } from "valibot";
import { useAccount } from "wagmi";

import type { Loan } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Receiver() {
  const { canGoBack } = router;
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
        router.push("/loan/review");
      } catch {
        toast.show("Invalid address", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
      }
    },
  });

  const displayInput = receiverType === "external";
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, receiver: undefined }));
            if (canGoBack()) {
              router.back();
              return;
            }
            router.replace("/loan/installments");
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
          <YStack gap="$s6">
            <YStack gap="$s4_5">
              <Text primary emphasized body>
                Select where to receive the loan
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
                    {({ state: { value, meta }, handleChange, setValue }) => {
                      return (
                        <YStack gap="$s4">
                          <XStack flexDirection="row">
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
                              onPress={() => {
                                getStringAsync()
                                  .then((text) => {
                                    setValue(text);
                                  })
                                  .catch(reportError);
                              }}
                            >
                              <ButtonIcon>
                                <ClipboardPaste size={24} color="$interactiveOnBaseBrandSoft" />
                              </ButtonIcon>
                            </Button>
                          </XStack>
                          {meta.errors.length > 0 ? (
                            <Text padding="$s3" footnote color="$uiNeutralSecondary">
                              {meta.errors[0]?.message.split(",")[0]}
                            </Text>
                          ) : undefined}
                          <Text caption2 color="$uiNeutralPlaceholder">
                            Send funds only to {chain.name} addresses. Sending assets to any other network will cause
                            irreversible loss of funds.
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
                          <Text caption2 color="$uiNeutralPlaceholder">
                            Arrival time ≈ 5 min.
                          </Text>
                        </YStack>
                      );
                    }}
                  </form.Field>
                )}
              </YStack>
            </YStack>
          </YStack>
          <YStack>
            <form.Subscribe selector={({ canSubmit, isValid }) => [canSubmit, isValid]}>
              {([, isValid]) => {
                return (
                  <Button
                    main
                    spaced
                    outlined
                    onPress={() => {
                      form.handleSubmit().catch(reportError);
                    }}
                    disabled={!isValid}
                    backgroundColor={isValid ? "$interactiveBaseBrandSoftDefault" : "$interactiveDisabled"}
                    color={isValid ? "$interactiveOnBaseBrandSoft" : "$interactiveOnDisabled"}
                    iconAfter={
                      <ArrowRight
                        color={isValid ? "$interactiveOnBaseBrandSoft" : "$interactiveOnDisabled"}
                        strokeWidth={2.5}
                      />
                    }
                    flex={0}
                  >
                    Continue
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
