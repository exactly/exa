import React from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, QrCode } from "@tamagui/lucide-icons";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import { ChainType } from "@lifi/sdk";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import Contacts from "./Contacts";
import RecentContacts from "./RecentContacts";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions } from "../../utils/lifi";
import receiverSchema from "../../utils/receiverSchema";
import reportError from "../../utils/reportError";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "@exactly/common/validation";

export default function ReceiverSelection() {
  const router = useRouter();
  const { receiver, asset, toChain, toToken } = useLocalSearchParams();
  const { t } = useTranslation();
  const destination = typeof toChain === "string" ? Number(toChain) : chain.id;
  const { data: chains } = useQuery(lifiChainsOptions);
  const destinationChain = chains?.find((item) => item.id === destination);
  const evm = !destinationChain || destinationChain.chainType === ChainType.EVM;

  const { data: recentContacts } = useQuery<undefined | { address: Address; ens: string }[]>({
    queryKey: ["contacts", "recent"],
  });

  const { data: savedContacts } = useQuery<undefined | { address: Address; ens: string }[]>({
    queryKey: ["contacts", "saved"],
  });

  const form = useForm({
    defaultValues: { receiver: typeof receiver === "string" ? receiver : "" },
    onSubmit: ({ value }) => {
      router.push({
        pathname: "/send-funds/amount",
        params: { receiver: value.receiver, asset, toChain, toToken },
      });
    },
  });

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <View flexDirection="row" gap="$s3_5" justifyContent="space-around" alignItems="center">
          <View position="absolute" left={0}>
            <IconButton
              icon={ArrowLeft}
              aria-label={t("Back")}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace("/(main)/(home)");
                }
              }}
            />
          </View>
          <Text color="$uiNeutralPrimary" fontSize={15} fontWeight="bold">
            {t("Send to")}
          </Text>
        </View>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <YStack flex={1} justifyContent="space-between">
            <YStack gap="$s5">
              <form.Field name="receiver" validators={{ onChange: receiverSchema(destination) }}>
                {({ state: { value, meta }, handleChange }) => (
                  <YStack gap="$s2">
                    <XStack flexDirection="row">
                      <Input
                        flex={1}
                        placeholder={t("Enter address")}
                        borderColor="$uiNeutralTertiary"
                        borderTopRightRadius={0}
                        borderBottomRightRadius={0}
                        value={value}
                        onChangeText={handleChange}
                        borderWidth={1}
                        focusStyle={{ borderColor: "$borderBrandStrong", borderWidth: 1 }}
                        backgroundColor="$backgroundSoft"
                      />
                      <Button
                        outlined
                        secondary
                        borderColor="$uiNeutralTertiary"
                        borderLeftWidth={0}
                        minHeight="auto"
                        padding="$s3"
                        aria-label={t("Scan QR code")}
                        borderTopLeftRadius={0}
                        borderBottomLeftRadius={0}
                        onPress={() => {
                          router.push({ pathname: "/send-funds/qr", params: { asset, toChain, toToken } });
                        }}
                      >
                        <Button.Icon>
                          <QrCode />
                        </Button.Icon>
                      </Button>
                    </XStack>
                    {meta.errors.length > 0 ? (
                      <Text padding="$s3" footnote color="$uiNeutralSecondary">
                        {meta.errors[0]?.message.split(",")[0]}
                      </Text>
                    ) : undefined}
                    <Text padding="$s3" caption color="$uiNeutralPlaceholder" mono>
                      {`${destinationChain?.name ?? destination} · ${destinationChain?.chainType ?? "?"} · ${typeof toToken === "string" ? toToken : "?"}`}
                    </Text>
                  </YStack>
                )}
              </form.Field>
              {evm && (recentContacts ?? savedContacts) && (
                <ScrollView maxHeight={350} gap="$s4" showsVerticalScrollIndicator={false}>
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
              <Text color="$uiNeutralPlaceholder" fontSize={13} textAlign="justify">
                {t(
                  "Make sure that the receiving address is compatible with {{chain}} network. Sending assets on other networks may result in irreversible loss of funds.",
                  { chain: destinationChain?.name ?? chain.name },
                )}
                <Text
                  color="$uiBrandSecondary"
                  fontSize={13}
                  fontWeight="bold"
                  cursor="pointer"
                  onPress={() => {
                    presentArticle("9056481").catch(reportError);
                  }}
                >
                  {" "}
                  {t("Learn more about sending funds.")}
                </Text>
              </Text>
              <Text color="$uiNeutralPlaceholder" caption2 textAlign="justify">
                {t("Arrival time ≈ {{minutes}} min.", { minutes: 1 })}
              </Text>
            </YStack>
            <form.Subscribe selector={({ canSubmit }) => canSubmit}>
              {(canSubmit) => {
                return (
                  <Button
                    primary
                    disabled={!canSubmit}
                    onPress={() => {
                      form.handleSubmit().catch(reportError);
                    }}
                  >
                    <Button.Text>{t("Next")}</Button.Text>
                    <Button.Icon>
                      <ArrowRight />
                    </Button.Icon>
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
