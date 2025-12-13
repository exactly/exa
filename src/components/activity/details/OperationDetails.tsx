import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { CreditActivity, DebitActivity, InstallmentsActivity } from "@exactly/server/api/activity";
import { CalendarClock, CreditCard, SquareArrowOutUpRight } from "@tamagui/lucide-icons";
import { format } from "date-fns";
import { setStringAsync } from "expo-clipboard";
import React from "react";
import { Alert } from "react-native";
import { Separator, XStack, YStack } from "tamagui";

import openBrowser from "../../../utils/openBrowser";
import reportError from "../../../utils/reportError";
import Text from "../../shared/Text";

export default function OperationDetails({ item }: { item: CreditActivity | DebitActivity | InstallmentsActivity }) {
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          Purchase details
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            ID
          </Text>
          <Text
            callout
            color="$uiNeutralPrimary"
            onPress={() => {
              setStringAsync(item.id).catch(reportError);
              Alert.alert("Copied!", "The operation ID has been copied to the clipboard.");
            }}
            hitSlop={15}
          >
            {shortenHex(item.id)}
          </Text>
        </XStack>

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Total
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {Number(item.usdAmount).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
        </XStack>

        {item.mode !== 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Installments
            </Text>
            <Text emphasized callout color="$uiNeutralPrimary">
              {item.mode === 1 && `1x ${Number(item.usdAmount + item.borrow.fee).toFixed(2)}`}
              {item.mode > 1 && `${(item as InstallmentsActivity).borrow.installments.length}x`}&nbsp;
              {item.mode > 1 &&
                Number(item.usdAmount / (item as InstallmentsActivity).borrow.installments.length).toFixed(2)}
              &nbsp;USDC
            </Text>
          </XStack>
        )}

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Mode
          </Text>
          <XStack alignItems="center" gap="$s2">
            <Text primary callout>
              {item.mode > 0 ? "Pay Later" : "Card"}
            </Text>
            {item.mode > 0 ? (
              <CalendarClock size={20} color="$uiBrandPrimary" />
            ) : (
              <CreditCard size={20} color="$uiBrandPrimary" />
            )}
          </XStack>
        </XStack>

        {item.mode > 0 && (
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Fixed rate APR
            </Text>
            <Text callout color="$uiNeutralPrimary">
              {Number(item.mode > 0 && (item as CreditActivity).borrow.rate).toLocaleString(undefined, {
                style: "percent",
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </Text>
          </XStack>
        )}

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Date
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(item.timestamp, "yyyy-MM-dd")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Time
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(item.timestamp, "HH:mm:ss")}
          </Text>
        </XStack>

        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Transaction hash
          </Text>
          <XStack
            alignItems="center"
            gap="$s3"
            onPress={() => {
              openBrowser(`${chain.blockExplorers?.default.url}/tx/${item.transactionHash}`).catch(reportError);
            }}
          >
            <Text textDecorationLine="underline" callout color="$uiNeutralPrimary">
              {shortenHex(item.transactionHash)}
            </Text>
            <SquareArrowOutUpRight size={20} color="$uiNeutralSecondary" />
          </XStack>
        </XStack>
      </YStack>
    </YStack>
  );
}
