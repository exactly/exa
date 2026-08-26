import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Keyboard } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CircleHelp,
  Pencil,
  Plus,
  QrCode,
  Search,
  Wallet,
  X,
} from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import { ChainType } from "@lifi/sdk";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { safeParse } from "valibot";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";

import ContactSheet from "./ContactSheet";
import ensOptions, { ensName } from "../../utils/ensOptions";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, receiverSchema } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import Blocky from "../shared/Blocky";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ReceiverSelection() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const toast = useToastController();
  const { receiver, asset, fromChain, toChain, toToken, toSymbol, amount, fromAmount } = useLocalSearchParams();
  const destination = typeof toChain === "string" ? Number(toChain) : chain.id;
  const { data: chains, isFetching, refetch } = useQuery(lifiChainsOptions);
  const destinationChain = chains?.find((item) => item.id === destination);
  const chainType = destinationChain?.chainType ?? (destination === chain.id ? ChainType.EVM : undefined);
  const evm = chainType === ChainType.EVM;
  const symbol = typeof toSymbol === "string" ? toSymbol : undefined;

  const { data: savedContacts } = useQuery<Contact[] | undefined>({ queryKey: ["contacts", "saved"] });
  const { data: recentContacts } = useQuery<Contact[] | undefined>({ queryKey: ["contacts", "recent"] });
  const [editing, setEditing] = useState<{ address: Address; ens: string; list: "recent" | "saved" }>();

  const form = useForm({ defaultValues: { receiver: "" } });
  useEffect(() => {
    if (typeof receiver !== "string") return;
    form.setFieldValue("receiver", receiver);
    router.setParams({ receiver: undefined });
  }, [form, receiver, router]);
  const value = useStore(form.store, ({ values }) => values.receiver);
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), 300);
    return () => clearTimeout(timer);
  }, [value]);
  const name = evm ? ensName(value) : undefined;
  const { data: resolved, isPending: resolving } = useQuery(
    ensOptions(settled === value ? name : undefined, destination),
  );

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

  const parsed = safeParse(receiverSchema(chainType), value);
  const hex = safeParse(Address, resolved ?? (parsed.success ? value.trim() : ""));
  const recipient = hex.success ? hex.output : undefined;
  const ready = name ? !!resolved : parsed.success;

  function submit(to: string, ens?: string) {
    router.push({
      pathname: "/send-funds/confirm",
      params: { receiver: to, ens, asset, fromChain, toChain, toToken, amount, fromAmount },
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
                      {name && resolving ? (
                        <View
                          width={40}
                          height={40}
                          backgroundColor="$backgroundMild"
                          alignItems="center"
                          justifyContent="center"
                        >
                          <Spinner size="small" color="$uiBrandSecondary" />
                        </View>
                      ) : value ? (
                        <View
                          padding="$s3"
                          backgroundColor="$backgroundMild"
                          cursor="pointer"
                          pressStyle={{ opacity: 0.7 }}
                          role="button"
                          aria-label={t("Clear")}
                          onPress={() => {
                            handleChange("");
                          }}
                        >
                          <X size={24} color="$iconBrandDefault" />
                        </View>
                      ) : (
                        <View
                          padding="$s3"
                          backgroundColor="$backgroundMild"
                          cursor="pointer"
                          pressStyle={{ opacity: 0.7 }}
                          role="button"
                          aria-label={t("Scan QR code")}
                          onPress={() => {
                            router.push({
                              pathname: "/send-funds/qr",
                              params: { asset, fromChain, toChain, toToken, toSymbol, amount, fromAmount },
                            });
                          }}
                        >
                          <QrCode size={24} color="$iconBrandDefault" />
                        </View>
                      )}
                    </XStack>
                    {name && !resolved && !resolving ? (
                      <Text padding="$s3" footnote color="$uiErrorSecondary">
                        {t("No address found for {{name}}", { name })}
                      </Text>
                    ) : !name && value && meta.isBlurred && meta.errors.length > 0 ? (
                      <Text padding="$s3" footnote color="$uiErrorSecondary">
                        {t("Invalid {{chain}} address", { chain: (destinationChain ?? chain).name })}
                      </Text>
                    ) : undefined}
                  </YStack>
                )}
              </form.Field>
              {!!recipient && (
                <YStack gap="$s4">
                  <XStack gap="$s3" alignItems="center">
                    <View padding="$s3" borderRadius="$r3" backgroundColor="$backgroundMild">
                      <Wallet size={20} color="$uiNeutralPrimary" />
                    </View>
                    <Text flex={1} subHeadline primary mono={!name} numberOfLines={1}>
                      {name ?? shortenHex(recipient, 6, 6)}
                    </Text>
                    <Check size={16} color="$uiSuccessSecondary" />
                  </XStack>
                  {!savedContacts?.some(({ address }) => address === recipient) && (
                    <XStack
                      gap="$s3"
                      alignItems="center"
                      cursor="pointer"
                      pressStyle={{ opacity: 0.7 }}
                      role="button"
                      aria-label={t("Save contact")}
                      onPress={() => {
                        queryClient.setQueryData<Contact[] | undefined>(["contacts", "saved"], (old) => [
                          { address: recipient, ens: name ?? "" },
                          ...(old ?? []),
                        ]);
                        toast.show(t("Contact saved successfully"), {
                          duration: 2000,
                          burntOptions: { haptic: "success", preset: "done" },
                        });
                      }}
                    >
                      <View padding="$s3" borderRadius="$r3" backgroundColor="$backgroundMild">
                        <Plus size={20} color="$interactiveOnBaseBrandSoft" />
                      </View>
                      <Text subHeadline primary>
                        {t("Save contact")}
                      </Text>
                    </XStack>
                  )}
                </YStack>
              )}
              {!value &&
                evm &&
                (
                  [
                    { title: t("Contacts"), contacts: savedContacts, list: "saved" },
                    { title: t("Recent"), contacts: recentContacts, list: "recent" },
                  ] as const
                ).map(({ title, contacts, list }) =>
                  contacts?.length ? (
                    <YStack key={title} gap="$s5">
                      <Text subHeadline color="$uiNeutralPlaceholder">
                        {title}
                      </Text>
                      {contacts.map((contact) => (
                        <XStack
                          key={contact.address}
                          gap="$s3"
                          alignItems="center"
                          cursor="pointer"
                          pressStyle={{ opacity: 0.7 }}
                          role="button"
                          aria-label={contact.ens || contact.address}
                          onPress={() => {
                            if (contact.ens) {
                              queryClient
                                .fetchQuery(ensOptions(contact.ens, destination))
                                .then((address) => submit(address ?? contact.address, contact.ens))
                                .catch(() => submit(contact.address, contact.ens));
                            } else {
                              submit(contact.address);
                            }
                          }}
                        >
                          <View borderRadius="$r_0" overflow="hidden">
                            <Blocky seed={contact.address} />
                          </View>
                          <YStack gap="$s2" flex={1}>
                            <Text subHeadline primary mono={!contact.ens}>
                              {contact.ens || shortenHex(contact.address, 6, 6)}
                            </Text>
                            {!!contact.ens && (
                              <Text caption secondary mono>
                                {shortenHex(contact.address, 6, 6)}
                              </Text>
                            )}
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
                            icon={Pencil}
                            size={16}
                            color="$uiBrandSecondary"
                            aria-label={t("Edit contact")}
                            onPress={(event) => {
                              event.stopPropagation();
                              Keyboard.dismiss();
                              setEditing({ address: contact.address, ens: contact.ens, list });
                            }}
                          />
                        </XStack>
                      ))}
                    </YStack>
                  ) : undefined,
                )}
            </YStack>
            <Button
              primary
              disabled={!ready}
              onPress={() => {
                submit(resolved ?? (parsed.success ? parsed.output : value), resolved ? name : undefined);
              }}
            >
              <Button.Text>{ready ? t("Continue") : t("Enter recipient's address")}</Button.Text>
              <Button.Icon>{ready ? <ArrowRight size={20} /> : <ArrowUp size={20} />}</Button.Icon>
            </Button>
          </YStack>
        </ScrollView>
      </View>
      <ContactSheet
        contact={editing}
        onClose={() => {
          setEditing(undefined);
        }}
        onDelete={() => {
          if (!editing) return;
          queryClient.setQueryData<Contact[] | undefined>(["contacts", editing.list], (old) =>
            old?.filter(({ address }) => address !== editing.address),
          );
          setEditing(undefined);
        }}
      />
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

type Contact = { address: Address; date?: number; ens: string };
