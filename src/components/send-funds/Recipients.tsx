import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Contact, PencilLine, Settings, TriangleAlert } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Spinner, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";

import { bridgeMethods, isValidCurrency } from "../../utils/currencies";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, deleteExternalAccount, listExternalAccounts } from "../../utils/server";
import AddFundsOption from "../add-funds/AddFundsOption";
import Blocky from "../shared/Blocky";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Recipients() {
  const { t } = useTranslation();
  const router = useRouter();
  const { currency, provider } = useLocalSearchParams();
  const toast = useToastController();

  const {
    data: allRecipients,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["ramp", "external-accounts"],
    queryFn: listExternalAccounts,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteExternalAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ramp", "external-accounts"] }).catch(reportError);
      toast.show(t("Contact deleted"), {
        native: true,
        duration: 2000,
        burntOptions: { haptic: "success", preset: "done" },
      });
    },
    onError: (error) => {
      const inUse = error instanceof APIError && error.text === "withdrawal in progress";
      if (!inUse) reportError(error);
      toast.show(
        inUse
          ? t("Can't delete this contact while a withdrawal is in progress.")
          : t("Couldn't delete the contact. Please try again."),
        { native: true, duration: 3000, burntOptions: { haptic: "error", preset: "error" } },
      );
    },
  });

  if (typeof currency !== "string" || !isValidCurrency(currency) || provider !== "bridge") {
    return <Redirect href="/send-funds" />;
  }

  const method = currency in bridgeMethods ? bridgeMethods[currency] : undefined;

  const recipients = allRecipients?.filter((recipient) => recipient.currency === currency) ?? [];

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s5" fullScreen padded>
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
            {t("Send / {{currency}}", { currency })}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <ScrollView flex={1}>
          <YStack flex={1} gap="$s5">
            <AddFundsOption
              icon={<Settings size={24} color="$iconBrandDefault" />}
              title={t("Transfer to a new recipient")}
              subtitle={method ? t("Via {{method}}", { method }) : t("Add new recipient")}
              onPress={() => {
                router.push({ pathname: "/send-funds/new-recipient", params: { currency, provider } });
              }}
            />
            <YStack gap="$s3_5" paddingHorizontal="$s3_5">
              <XStack gap="$s2" alignItems="center">
                <Contact size={16} color="$interactiveBaseBrandDefault" />
                <Text emphasized footnote color="$uiNeutralSecondary">
                  {t("Contacts")}
                </Text>
              </XStack>
              {isPending ? (
                <Skeleton width="100%" height={64} />
              ) : isError ? (
                <View
                  margin="$s2"
                  borderRadius="$r3"
                  backgroundColor="$uiNeutralTertiary"
                  padding="$s3_5"
                  alignSelf="center"
                >
                  <Text textAlign="center" subHeadline color="$uiNeutralSecondary">
                    {t("Couldn't load your contacts. Please try again.")}
                  </Text>
                </View>
              ) : recipients.length === 0 ? (
                <View margin="$s2" alignSelf="center">
                  <Text textAlign="center" subHeadline color="$uiNeutralSecondary">
                    {t("You don't have any contacts yet.")}
                  </Text>
                </View>
              ) : (
                <YStack gap="$s3_5">
                  {recipients.map((recipient) => (
                    <RecipientRow
                      key={recipient.id}
                      recipient={recipient}
                      fallbackBank={method ? t("Via {{method}}", { method }) : t("Bank account")}
                      deleting={deleteMutation.isPending && deleteMutation.variables === recipient.id}
                      onSelect={() => {
                        if (recipient.addressValid === false) {
                          toast.show(t("This contact needs review before you can send."), {
                            native: true,
                            duration: 3000,
                            burntOptions: { haptic: "warning" },
                          });
                          return;
                        }
                        router.push({
                          pathname: "/send-funds/send-amount",
                          params: { currency, provider, contactId: recipient.id },
                        });
                      }}
                      onEdit={() => {
                        router.push({
                          pathname: "/send-funds/edit-recipient",
                          params: { id: recipient.id, currency, provider },
                        });
                      }}
                      onDelete={() => {
                        deleteMutation.mutate(recipient.id);
                      }}
                    />
                  ))}
                </YStack>
              )}
            </YStack>
          </YStack>
        </ScrollView>
      </View>
    </SafeView>
  );
}

function RecipientRow({
  recipient,
  fallbackBank,
  deleting,
  onSelect,
  onEdit,
  onDelete,
}: {
  deleting: boolean;
  fallbackBank: string;
  onDelete: () => void;
  onEdit: () => void;
  onSelect: () => void;
  recipient: { addressValid?: boolean; bankName?: string; id: string; ownerName: string };
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <XStack
      alignItems="center"
      gap="$s3"
      paddingBottom="$s3_5"
      borderBottomWidth={1}
      borderBottomColor="$borderNeutralSoft"
      opacity={deleting ? 0.5 : 1}
    >
      <XStack
        flex={1}
        alignItems="center"
        gap="$s3"
        cursor="pointer"
        pressStyle={{ opacity: 0.7 }}
        onPress={deleting ? undefined : onSelect}
      >
        <View borderRadius="$r_0" overflow="hidden">
          <Blocky seed={recipient.id} />
        </View>
        <YStack flex={1} gap="$s1">
          <Text subHeadline primary>
            {recipient.ownerName}
          </Text>
          <Text caption color="$uiNeutralSecondary">
            {recipient.bankName ?? fallbackBank}
          </Text>
        </YStack>
      </XStack>
      {deleting ? (
        <Spinner color="$uiNeutralSecondary" />
      ) : (
        <>
          {recipient.addressValid === false && <TriangleAlert size={16} color="$uiWarningSecondary" />}
          <IconButton
            icon={PencilLine}
            size={16}
            color="$interactiveBaseBrandDefault"
            aria-label={t("Edit contact")}
            onPress={() => {
              setOpen(true);
            }}
          />
        </>
      )}
      <ModalSheet open={open} onClose={() => setOpen(false)}>
        <YStack
          gap="$s4"
          borderTopLeftRadius="$r5"
          borderTopRightRadius="$r5"
          backgroundColor="$backgroundSoft"
          paddingTop="$s6"
          paddingHorizontal="$s5"
          paddingBottom="$s7"
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <Button
            primary
            onPress={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <Button.Text>{t("Edit contact")}</Button.Text>
            <Button.Icon>
              <PencilLine size={20} />
            </Button.Icon>
          </Button>
          <Text
            emphasized
            footnote
            textAlign="center"
            color="$uiErrorSecondary"
            cursor="pointer"
            pressStyle={{ opacity: 0.7 }}
            onPress={() => {
              setOpen(false);
              onDelete();
            }}
          >
            {t("Delete contact")}
          </Text>
        </YStack>
      </ModalSheet>
    </XStack>
  );
}
