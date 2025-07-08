import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { CreditActivity, DebitActivity, InstallmentsActivity } from "@exactly/server/api/activity";
import { Copy } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { useTranslation } from "react-i18next";
import { Separator, XStack, YStack } from "tamagui";

import OptimismImage from "../../../assets/images/optimism.svg";
import openBrowser from "../../../utils/openBrowser";
import type { ActivityItem } from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import Text from "../../shared/Text";

export default function TransactionDetails({
  source,
}: {
  source?: CreditActivity | DebitActivity | InstallmentsActivity;
}) {
  const toast = useToastController();
  const query = useQuery<ActivityItem>({ queryKey: ["activity", "details"] });
  const { t } = useTranslation();
  const item = source ?? query.data;
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
        {item?.type === "sent" && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("To")}
            </Text>
            <XStack
              alignItems="center"
              gap="$s3"
              onPress={() => {
                setStringAsync(item.receiver).catch(reportError);
                toast.show(t("Address copied!"), {
                  native: true,
                  duration: 1000,
                  burntOptions: { haptic: "success" },
                });
              }}
            >
              <Text callout textDecorationLine="underline">
                {shortenHex(item.receiver)}
              </Text>
              <Copy size={20} color="$uiNeutralSecondary" />
            </XStack>
          </XStack>
        )}
        {item?.timestamp && item.type !== "card" && (
          <>
            <XStack justifyContent="space-between">
              <Text emphasized footnote color="$uiNeutralSecondary">
                {t("Date")}
              </Text>
              <Text callout color="$uiNeutralPrimary">
                {format(item.timestamp, "yyyy-MM-dd")}
              </Text>
            </XStack>
            <XStack justifyContent="space-between">
              <Text emphasized footnote color="$uiNeutralSecondary">
                {t("Time")}
              </Text>
              <Text callout color="$uiNeutralPrimary">
                {format(item.timestamp, "HH:mm:ss")}
              </Text>
            </XStack>
          </>
        )}
        {item?.type !== "panda" && item?.transactionHash && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              {t("Transaction hash")}
            </Text>
            <XStack alignItems="center" gap="$s3">
              <Text
                textDecorationLine="underline"
                callout
                color="$uiNeutralPrimary"
                cursor="pointer"
                onPress={() => {
                  const explorerUrl = chain.blockExplorers?.default.url;
                  if (!explorerUrl) return;
                  openBrowser(`${explorerUrl}/tx/${item.transactionHash}`).catch(reportError);
                }}
              >
                {shortenHex(item.transactionHash)}
              </Text>
              <XStack
                cursor="pointer"
                onPress={() => {
                  const explorerUrl = chain.blockExplorers?.default.url;
                  if (!explorerUrl) return;
                  setStringAsync(`${explorerUrl}/tx/${item.transactionHash}`).catch(reportError);
                  toast.show(t("Link copied!"), { native: true, duration: 1000, burntOptions: { haptic: "success" } });
                }}
              >
                <Copy size="$iconSize.md" strokeWidth="$iconStroke.md" color="$interactiveBaseBrandDefault" />
              </XStack>
            </XStack>
          </XStack>
        )}
      </YStack>
    </YStack>
  );
}
