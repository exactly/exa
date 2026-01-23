import React from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import { setStringAsync } from "expo-clipboard";

import { ExternalLink } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { format } from "date-fns";

import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";

import ChainLogo from "./ChainLogo";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import Text from "../shared/Text";

export default function TransactionDetails({ hash }: { hash?: string }) {
  const { t } = useTranslation();
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          {t("Transaction details")}
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Network fee")}
          </Text>
          <Text callout color="$uiSuccessSecondary">
            {t("FREE")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Network")}
          </Text>
          <XStack gap="$s3" alignItems="center">
            <Text callout color="$uiNeutralPrimary" alignContent="center">
              {chain.name}
            </Text>
            <ChainLogo size={20} />
          </XStack>
        </XStack>
        {hash && (
          <XStack
            hitSlop={15}
            justifyContent="space-between"
            alignItems="center"
            cursor="pointer"
            onPress={() => {
              setStringAsync(hash)
                .then(() => Alert.alert(t("Copied"), t("The transaction hash has been copied to the clipboard.")))
                .catch((error: unknown) => {
                  reportError(error);
                  Alert.alert(t("Error"), t("Failed to copy the transaction hash to the clipboard."));
                });
            }}
          >
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Transaction hash")}
            </Text>
            <XStack
              gap="$s2"
              alignItems="center"
              cursor="pointer"
              onPress={(event) => {
                event.stopPropagation();
                const explorerUrl = chain.blockExplorers?.default.url;
                if (!explorerUrl) return;
                openBrowser(`${explorerUrl}/tx/${hash}`).catch(reportError);
              }}
            >
              <Text callout fontFamily="$mono" textDecorationLine="underline">
                {shortenHex(hash)}
              </Text>
              <ExternalLink size={20} color="$uiBrandPrimary" />
            </XStack>
          </XStack>
        )}
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Date")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(new Date(), "yyyy-MM-dd")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            {t("Time")}
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(new Date(), "HH:mm:ss")}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
