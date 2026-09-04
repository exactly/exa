import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, ArrowUp, CircleHelp, QrCode, Search, Trash2 } from "@tamagui/lucide-icons";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import { ChainType } from "@lifi/sdk";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { safeParse } from "valibot";

import chain from "@exactly/common/generated/chain";

import ensOptions, { ensName } from "../../utils/ensOptions";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import receiverSchema from "../../utils/receiverSchema";
import reportError from "../../utils/reportError";
import Blocky from "../shared/Blocky";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "@exactly/common/validation";

export default function ReceiverSelection() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { receiver, asset, fromChain, toChain, toToken, amount, fromAmount } = useLocalSearchParams();
  const destination = typeof toChain === "string" ? Number(toChain) : chain.id;
  const { data: chains, isFetching, refetch } = useQuery(lifiChainsOptions);
  const { data: tokens } = useQuery(lifiTokensOptions);
  const destinationChain = chains?.find((item) => item.id === destination);
  const chainType = destinationChain?.chainType ?? (destination === chain.id ? ChainType.EVM : undefined);
  const evm = chainType === ChainType.EVM;
  const symbol =
    typeof toToken === "string"
      ? tokens?.find(
          (token) =>
            token.chainId === (destination as typeof token.chainId) &&
            token.address.toLowerCase() === toToken.toLowerCase(),
        )?.symbol
      : undefined;

  const { data: recentContacts } = useQuery<undefined | { address: Address; date?: number; ens: string }[]>({
    queryKey: ["contacts", "recent"],
  });

  const form = useForm({ defaultValues: { receiver: "" } });
  useEffect(() => {
    if (typeof receiver !== "string") return;
    form.setFieldValue("receiver", receiver);
    router.setParams({ receiver: undefined });
  }, [form, receiver, router]);
  const value = useStore(form.store, ({ values }) => values.receiver);
  const name = evm ? ensName(value) : undefined;
  const { data: resolved, isPending: resolving } = useQuery(ensOptions(name, destination));

  if (chainType === undefined) {
    return (
      <SafeView fullScreen>
        <View gap="$s4_5" fullScreen padded>
          <Header symbol={symbol} />
          <YStack flex={1} justifyContent="center" alignItems="center" gap="$s4">
            {isFetching ? (
              <Spinner size="large" color="$uiBrandSecondary" />
            ) : (
              <>
                <Text secondary subHeadline textAlign="center">
                  {t("Something went wrong. Please try again.")}
                </Text>
                <Button
                  secondary
                  onPress={() => {
                    refetch().catch(reportError);
                  }}
                >
                  <Button.Text>{t("Retry")}</Button.Text>
                </Button>
              </>
            )}
          </YStack>
        </View>
      </SafeView>
    );
  }

  const ready = name ? !!resolved : !!value && safeParse(receiverSchema(chainType), value).success;

  function submit(to: string) {
    router.push({
      pathname: "/send-funds/confirm",
      params: { receiver: to, asset, fromChain, toChain, toToken, amount, fromAmount },
    });
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <Header symbol={symbol} />
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <YStack flex={1} justifyContent="space-between" gap="$s5">
            <YStack gap="$s6">
              <form.Field name="receiver" validators={{ onChange: receiverSchema(chainType) }}>
                {({ state: { meta }, handleBlur, handleChange }) => (
                  <YStack gap="$s2">
                    <XStack
                      alignItems="center"
                      gap="$s2"
                      paddingLeft="$s3_5"
                      borderWidth={1}
                      borderColor="$borderNeutralSoft"
                      borderRadius="$r3"
                      overflow="hidden"
                    >
                      <Search size={20} color="$uiNeutralPlaceholder" />
                      <Input
                        flex={1}
                        borderWidth={0}
                        backgroundColor="transparent"
                        placeholder={
                          destinationChain && !evm
                            ? t("Enter {{chain}} address", { chain: destinationChain.name })
                            : t("Enter ENS or wallet address")
                        }
                        placeholderTextColor="$uiNeutralPlaceholder"
                        value={value}
                        onChangeText={handleChange}
                        onBlur={handleBlur}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      <View
                        padding="$s3"
                        backgroundColor="$backgroundMild"
                        cursor="pointer"
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => {
                          router.push({
                            pathname: "/send-funds/qr",
                            params: { asset, fromChain, toChain, toToken, amount, fromAmount },
                          });
                        }}
                      >
                        <QrCode size={24} color="$iconBrandDefault" />
                      </View>
                    </XStack>
                    {name ? (
                      resolved ? (
                        <Text padding="$s3" footnote secondary mono>
                          {resolved}
                        </Text>
                      ) : (
                        <Text padding="$s3" footnote color={resolving ? "$uiNeutralSecondary" : "$uiErrorSecondary"}>
                          {resolving ? t("Resolving...") : t("No address found for {{name}}", { name })}
                        </Text>
                      )
                    ) : value && meta.isBlurred && meta.errors.length > 0 ? (
                      <Text padding="$s3" footnote color="$uiErrorSecondary">
                        {t("Invalid {{chain}} address", { chain: (destinationChain ?? chain).name })}
                      </Text>
                    ) : undefined}
                  </YStack>
                )}
              </form.Field>
              {evm && recentContacts && recentContacts.length > 0 && (
                <YStack gap="$s5">
                  <Text subHeadline color="$uiNeutralPlaceholder">
                    {t("Recent")}
                  </Text>
                  {recentContacts.map((contact) => (
                    <XStack
                      key={contact.address}
                      gap="$s3"
                      alignItems="center"
                      cursor="pointer"
                      pressStyle={{ opacity: 0.7 }}
                      onPress={() => {
                        submit(contact.address);
                      }}
                    >
                      <View borderRadius="$r_0" overflow="hidden">
                        <Blocky seed={contact.address} />
                      </View>
                      <YStack gap="$s3" flex={1}>
                        <Text subHeadline primary mono>
                          {contact.address}
                        </Text>
                        {!!contact.date && (
                          <Text caption secondary numberOfLines={1}>
                            {t("Sent to on {{date}}", {
                              date: new Date(contact.date).toLocaleDateString(language, {
                                month: "long",
                                day: "numeric",
                              }),
                            })}
                          </Text>
                        )}
                      </YStack>
                      <IconButton
                        icon={Trash2}
                        size={16}
                        color="$uiErrorSecondary"
                        aria-label={t("Delete contact")}
                        onPress={(event) => {
                          event.stopPropagation();
                          queryClient.setQueryData<undefined | { address: Address; date?: number; ens: string }[]>(
                            ["contacts", "recent"],
                            (old) => old?.filter(({ address }) => address !== contact.address),
                          );
                        }}
                      />
                    </XStack>
                  ))}
                </YStack>
              )}
            </YStack>
            <Button
              primary
              disabled={!ready}
              onPress={() => {
                submit(resolved ?? value.trim());
              }}
            >
              <Button.Text>{ready ? t("Continue") : t("Enter recipient's address")}</Button.Text>
              <Button.Icon>{ready ? <ArrowRight size={20} /> : <ArrowUp size={20} />}</Button.Icon>
            </Button>
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}

function Header({ symbol }: { symbol?: string }) {
  const router = useRouter();
  const { t } = useTranslation();
  return (
    <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
      <IconButton
        icon={ArrowLeft}
        aria-label={t("Back")}
        onPress={() => {
          if (router.canGoBack()) router.back();
          else router.replace("/send-funds/amount");
        }}
      />
      <Text emphasized subHeadline primary>
        {symbol ? t("Send {{symbol}} to", { symbol }) : t("Send to")}
      </Text>
      <IconButton
        icon={CircleHelp}
        aria-label={t("Help")}
        onPress={() => {
          presentArticle("8950801").catch(reportError);
        }}
      />
    </XStack>
  );
}
