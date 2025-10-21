import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, Separator, XStack, YStack } from "tamagui";
import { parse, safeParse } from "valibot";

import Contacts from "./Contacts";
import RecentContacts from "./RecentContacts";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import queryClient, { type Withdraw } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddressSelection() {
  const navigation = useNavigation<AppNavigationProperties>("/(main)");
  const parameters = useLocalSearchParams();
  const { presentArticle } = useIntercom();

  const { data: recentContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });

  const { data: savedContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "saved"],
  });

  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });

  const form = useForm({
    defaultValues: { receiver: withdraw?.receiver ?? "" },
    onSubmit: ({ value }) => {
      const receiver = parse(Address, value.receiver);
      queryClient.setQueryData<Withdraw>(["withdrawal"], (old) =>
        old ? { ...old, receiver } : { receiver, market: undefined, amount: 0n },
      );
      navigation.navigate("send-funds", { screen: "asset" });
    },
  });

  const { success, output } = safeParse(Address, parameters.receiver);

  if (success) {
    form.setFieldValue("receiver", output);
    form.validateAllFields("change").catch(reportError);
  }

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View flexDirection="row" gap={10} justifyContent="space-around" alignItems="center">
          <View position="absolute" left={0}>
            <Pressable
              onPress={() => {
                queryClient.setQueryData(["withdrawal"], { receiver: undefined, market: undefined, amount: 0n });
                if (navigation.canGoBack()) {
                  navigation.goBack();
                } else {
                  navigation.replace("(home)", { screen: "index" });
                }
              }}
            >
              <ArrowLeft size={24} color="$uiNeutralPrimary" />
            </Pressable>
          </View>
          <Text color="$uiNeutralPrimary" fontSize={15} fontWeight="bold">
            Send to
          </Text>
        </View>
        <ScrollView
          // eslint-disable-next-line react-native/no-inline-styles
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <YStack flex={1} justifyContent="space-between">
            <YStack gap="$s5">
              <form.Field name="receiver" validators={{ onChange: Address }}>
                {({ state: { value, meta }, handleChange }) => (
                  <YStack gap="$s2">
                    <XStack flexDirection="row">
                      <Input
                        neutral
                        flex={1}
                        placeholder={`Enter ${chain.name} address`}
                        borderColor="$uiNeutralTertiary"
                        borderRightColor="transparent"
                        borderTopRightRadius={0}
                        borderBottomRightRadius={0}
                        value={value}
                        onChangeText={handleChange}
                      />
                    </XStack>
                    {meta.errors.length > 0 ? (
                      <Text padding="$s3" footnote color="$uiNeutralSecondary">
                        {meta.errors[0]?.message.split(",")[0]}
                      </Text>
                    ) : undefined}
                  </YStack>
                )}
              </form.Field>
              {(recentContacts ?? savedContacts) && (
                <ScrollView maxHeight={350} gap="$s4">
                  {recentContacts && recentContacts.length > 0 && (
                    <RecentContacts
                      onContactPress={(address) => {
                        form.setFieldValue("receiver", address);
                        form.validateAllFields("change").catch(reportError);
                      }}
                    />
                  )}
                  {recentContacts && savedContacts && (
                    <XStack paddingVertical="$s4">
                      <Separator borderColor="$borderNeutralSoft" />
                    </XStack>
                  )}
                  {savedContacts && savedContacts.length > 0 && (
                    <Contacts
                      onContactPress={(address) => {
                        form.setFieldValue("receiver", address);
                        form.validateAllFields("change").catch(reportError);
                      }}
                    />
                  )}
                </ScrollView>
              )}
              <Text color="$uiNeutralPlaceholder" fontSize={13} lineHeight={16} textAlign="justify">
                Make sure that the receiving address is compatible with {chain.name} network. Sending assets on other
                networks may result in irreversible loss of funds.
                <Text
                  color="$uiBrandSecondary"
                  fontSize={13}
                  lineHeight={16}
                  fontWeight="bold"
                  cursor="pointer"
                  onPress={() => {
                    presentArticle("9056481").catch(reportError);
                  }}
                >
                  &nbsp;Learn more about sending funds.
                </Text>
              </Text>
              <Text color="$uiNeutralPlaceholder" caption2 textAlign="justify">
                Arrival time ≈ 5 min.
              </Text>
            </YStack>
            <form.Subscribe selector={({ canSubmit }) => canSubmit}>
              {(canSubmit) => {
                return (
                  <Button
                    contained
                    main
                    spaced
                    disabled={!canSubmit}
                    iconAfter={
                      <ArrowRight color={canSubmit ? "$interactiveOnBaseBrandDefault" : "$interactiveOnDisabled"} />
                    }
                    onPress={() => {
                      form.handleSubmit().catch(reportError);
                    }}
                  >
                    Next
                  </Button>
                );
              }}
            </form.Subscribe>
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}
