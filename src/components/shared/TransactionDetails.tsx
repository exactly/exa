import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { ExternalLink } from "@tamagui/lucide-icons";
import { format } from "date-fns";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";
import { Separator, XStack, YStack } from "tamagui";

import OptimismImage from "../../assets/images/optimism.svg";
import reportError from "../../utils/reportError";
import useOpenBrowser from "../../utils/useOpenBrowser";
import Text from "../shared/Text";

export default function TransactionDetails({ hash }: { hash?: string }) {
  const openBrowser = useOpenBrowser();
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
            <OptimismImage height={20} width={20} />
          </XStack>
        </XStack>
        {hash && (
          <>
            <XStack
              hitSlop={15}
              justifyContent="space-between"
              alignItems="center"
              onPress={() => {
                setStringAsync(hash).catch(reportError);
                Alert.alert(t("Copied"), t("The transaction hash has been copied to the clipboard."));
              }}
            >
              <Text emphasized footnote color="$uiNeutralSecondary">
                {t("Transaction hash")}
              </Text>
              <XStack gap="$s2" alignItems="center" cursor="pointer">
                <Text
                  callout
                  fontFamily="$mono"
                  textDecorationLine="underline"
                  onPress={() => {
                    openBrowser(`${chain.blockExplorers?.default.url}/tx/${hash}`).catch(reportError);
                  }}
                >
                  {shortenHex(hash)}
                </Text>
                <ExternalLink size={20} color="$uiBrandPrimary" />
              </XStack>
            </XStack>
          </>
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
