import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { Trash2 } from "@tamagui/lucide-icons-2";
import { useToastController } from "@tamagui/toast";
import { YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, deleteExternalAccount } from "../../utils/server";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function MissingTransferSheet({
  contactId,
  currency,
  provider,
  open,
}: {
  contactId: string;
  currency: string;
  open: boolean;
  provider: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();

  const remove = useMutation({
    mutationFn: deleteExternalAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ramp", "external-accounts"] }).catch(reportError);
      router.replace({ pathname: "/send-funds/new-recipient", params: { currency, provider } });
    },
    onError: (error) => {
      const inUse = error instanceof APIError && error.text === "withdrawal in progress";
      if (!inUse) reportError(error);
      toast.show(
        inUse
          ? t("Can't delete this contact while a withdrawal is in progress.")
          : t("Couldn't delete the contact. Please try again."),
        { duration: 3000, burntOptions: { haptic: "error", preset: "error" } },
      );
    },
  });

  function cancel() {
    if (router.canGoBack()) router.back();
    else router.replace("/send-funds");
  }

  return (
    <ModalSheet open={open} onClose={cancel} disableDrag dismissible={false}>
      <YStack
        gap="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5" paddingTop="$s7" paddingHorizontal="$s5">
          <Text emphasized headline>
            {t("We can't load this contact")}
          </Text>
          <Text subHeadline color="$uiNeutralSecondary">
            {t(
              "The transfer details saved for this contact aren't available. To send to them, delete the contact and add their account details again.",
            )}
          </Text>
        </YStack>
        <YStack gap="$s4" paddingHorizontal="$s5" paddingBottom="$s7">
          <Button
            danger
            width="100%"
            disabled={remove.isPending}
            loading={remove.isPending}
            onPress={() => {
              remove.mutate(contactId);
            }}
          >
            <Button.Text>{t("Delete contact")}</Button.Text>
            <Button.Icon>
              <Trash2 />
            </Button.Icon>
          </Button>
          <Text
            emphasized
            footnote
            textAlign="center"
            color="$interactiveTextBrandDefault"
            cursor="pointer"
            pressStyle={{ opacity: 0.7 }}
            onPress={cancel}
          >
            {t("Cancel")}
          </Text>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
