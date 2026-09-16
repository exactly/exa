import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Keyboard, type View as RNView } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  Contact as ContactIcon,
  Pencil,
  Plus,
  QrCode,
  Search,
  Settings,
  Wallet,
  X,
} from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { AnimatePresence, ScrollView, Spinner, XStack, YStack } from "tamagui";

import { ChainType } from "@lifi/sdk";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { safeParse } from "valibot";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";

import AdvancedIntroSheet from "./AdvancedIntroSheet";
import AdvancedSheet from "./AdvancedSheet";
import ContactSheet from "./ContactSheet";
import ensOptions, { ensName } from "../../utils/ensOptions";
import { chainTypeOf, lifiChainsOptions, receiverSchema } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import Blocky from "../shared/Blocky";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Spotlight from "../shared/Spotlight";
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
  const { receiver, asset } = useLocalSearchParams();

  const { data: advanced } = useQuery<boolean>({ queryKey: ["settings", "advanced-mode"] });
  const { data: introSeen } = useQuery<boolean>({ queryKey: ["settings", "advanced-intro"] });
  const { data: spotlightSeen } = useQuery<boolean>({ queryKey: ["settings", "advanced-spotlight"] });
  const { data: chains } = useQuery(lifiChainsOptions);
  const [settings, setSettings] = useState(false);
  const cogRef = useRef<RNView>(null);

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
  const name = ensName(value);
  const { data: resolved, isPending: resolving } = useQuery(ensOptions(settled === value ? name : undefined, chain.id));

  const chainType = chainTypeOf(value);
  const incompatible = !advanced && !!chainType && chainType !== ChainType.EVM;
  const parsed = chainType && safeParse(receiverSchema(chainType), value);
  const hex = safeParse(Address, resolved ?? (parsed?.success ? value.trim() : ""));
  const recipient = hex.success ? hex.output : undefined;
  const ready = name ? !!resolved : !!chainType && !incompatible;

  function submit(to: string, type: ChainType, ens?: string) {
    const preset = safeParse(Address, asset);
    router.push(
      preset.success && type === ChainType.EVM
        ? { pathname: "/send-funds/amount", params: { receiver: to, ens, chainType: type, asset: preset.output } }
        : { pathname: "/send-funds/asset", params: { receiver: to, ens, chainType: type } },
    );
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds");
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Send to")}
          </Text>
          <View ref={cogRef}>
            <IconButton
              icon={Settings}
              aria-label={t("Send settings")}
              onPress={() => {
                setSettings(true);
              }}
            />
          </View>
        </XStack>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <YStack flex={1} justifyContent="space-between" gap="$s5">
            <YStack gap="$s6">
              <YStack gap="$s3">
                <form.Field name="receiver">
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
                          placeholder={t("Enter ENS or wallet address")}
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
                              router.push("/send-funds/qr");
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
                      ) : !name && value && meta.isBlurred && !chainType ? (
                        <Text padding="$s3" footnote color="$uiErrorSecondary">
                          {t("Invalid receiver address")}
                        </Text>
                      ) : undefined}
                    </YStack>
                  )}
                </form.Field>
                <AnimatePresence>
                  {advanced && (
                    <XStack
                      key="advanced"
                      animation="default"
                      animateOnly={["opacity", "transform"]}
                      enterStyle={{ opacity: 0, transform: [{ translateY: -8 }] }}
                      exitStyle={{ opacity: 0, transform: [{ translateY: -8 }] }}
                      gap="$s2"
                      alignSelf="center"
                      alignItems="center"
                      paddingHorizontal="$s3_5"
                      paddingVertical="$s2"
                      borderRadius="$r_0"
                      backgroundColor="$backgroundMild"
                    >
                      <Text caption secondary>
                        {t("Advanced mode on.")}
                      </Text>
                      <Text
                        emphasized
                        caption
                        brand
                        textDecorationLine="underline"
                        role="button"
                        cursor="pointer"
                        pressStyle={{ opacity: 0.7 }}
                        onPress={() => {
                          queryClient.setQueryData(["settings", "advanced-mode"], false);
                        }}
                      >
                        {t("Turn off")}
                      </Text>
                    </XStack>
                  )}
                </AnimatePresence>
                {incompatible && (
                  <XStack
                    gap="$s3"
                    alignItems="center"
                    justifyContent="space-between"
                    padding="$s3_5"
                    borderRadius="$r3"
                    backgroundColor="$interactiveBaseErrorSoftDefault"
                  >
                    <Text flex={1} caption2 color="$uiErrorSecondary">
                      {t("This is a {{network}} address. Turn on Advanced mode to send to other networks.", {
                        network: chains?.find((item) => item.chainType === chainType)?.name ?? "",
                      })}
                    </Text>
                    <Text
                      emphasized
                      caption2
                      brand
                      role="button"
                      cursor="pointer"
                      pressStyle={{ opacity: 0.7 }}
                      onPress={() => {
                        queryClient.setQueryData(["settings", "advanced-mode"], true);
                      }}
                    >
                      {t("Turn it on")}
                    </Text>
                  </XStack>
                )}
              </YStack>
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
                (
                  [
                    { title: t("Contacts"), contacts: savedContacts, list: "saved" },
                    { title: t("Recent"), contacts: recentContacts, list: "recent" },
                  ] as const
                ).map(({ title, contacts, list }) =>
                  contacts?.length ? (
                    <YStack key={title} gap="$s5">
                      <XStack gap="$s3" alignItems="center">
                        <ContactIcon size={16} color="$uiNeutralSecondary" />
                        <Text subHeadline color="$uiNeutralSecondary">
                          {title}
                        </Text>
                      </XStack>
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
                                .fetchQuery(ensOptions(contact.ens, chain.id))
                                .then((address) => submit(address ?? contact.address, ChainType.EVM, contact.ens))
                                .catch(() => submit(contact.address, ChainType.EVM, contact.ens));
                            } else {
                              submit(contact.address, ChainType.EVM);
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
                if (!chainType && !resolved) return;
                submit(
                  resolved ?? (parsed?.success ? parsed.output : value),
                  resolved ? ChainType.EVM : (chainType ?? ChainType.EVM),
                  resolved ? name : undefined,
                );
              }}
            >
              <Button.Text>{ready ? t("Continue") : t("Enter recipient's address")}</Button.Text>
              <Button.Icon>{ready ? <ArrowRight size={20} /> : <ArrowUp size={20} />}</Button.Icon>
            </Button>
          </YStack>
        </ScrollView>
      </View>
      <AdvancedIntroSheet
        open={!introSeen}
        onEnable={() => {
          queryClient.setQueryData(["settings", "advanced-mode"], true);
          queryClient.setQueryData(["settings", "advanced-intro"], true);
        }}
        onDismiss={() => {
          queryClient.setQueryData(["settings", "advanced-intro"], true);
        }}
      />
      <AdvancedSheet
        advanced={!!advanced}
        open={settings}
        onChange={(enabled) => {
          queryClient.setQueryData(["settings", "advanced-mode"], enabled);
        }}
        onClose={() => {
          setSettings(false);
        }}
      />
      {introSeen && !spotlightSeen && (
        <Spotlight
          dismissible
          label={t("Turn on Advanced mode at any time")}
          targetRef={cogRef}
          onDismiss={() => {
            queryClient.setQueryData(["settings", "advanced-spotlight"], true);
          }}
          onPress={() => {
            setSettings(true);
          }}
        >
          <Text footnote centered>
            <Trans
              i18nKey="Turn on <strong>Advanced mode</strong> at any time"
              components={{ strong: <Text emphasized footnote /> }}
            />
          </Text>
        </Spotlight>
      )}
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

type Contact = { address: Address; date?: number; ens: string };
