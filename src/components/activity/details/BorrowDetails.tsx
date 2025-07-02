import chain from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import type { BorrowActivity } from "@exactly/server/api/activity";
import { Copy } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { format } from "date-fns";
import { setStringAsync } from "expo-clipboard";
import { openBrowserAsync } from "expo-web-browser";
import React from "react";
import { Separator, XStack, YStack } from "tamagui";
import { useAccount } from "wagmi";

import assetLogos from "../../../utils/assetLogos";
import reportError from "../../../utils/reportError";
import AssetLogo from "../../shared/AssetLogo";
import Text from "../../shared/Text";

export default function BorrowDetails({ item }: { item: Omit<BorrowActivity, "blockNumber"> }) {
  const { address } = useAccount();
  const toast = useToastController();
  const { currency, receiver, fee, maturity, assets } = item;
  return (
    <YStack gap="$s7">
      <YStack gap="$s4">
        <YStack gap="$s4">
          <Text emphasized headline>
            Loan details
          </Text>
          <Separator height={1} borderColor="$borderNeutralSoft" />
        </YStack>
        <YStack gap="$s3_5">
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Receiving address
            </Text>
            {receiver.toLowerCase() === address?.toLowerCase() ? (
              <Text callout color="$uiNeutralPrimary">
                Your Exa account
              </Text>
            ) : (
              <XStack alignItems="center" gap="$s3">
                <Text
                  textDecorationLine="underline"
                  callout
                  color="$uiNeutralPrimary"
                  cursor="pointer"
                  onPress={() => {
                    openBrowserAsync(`${chain.blockExplorers?.default.url}/tx/${item.transactionHash}`).catch(
                      reportError,
                    );
                  }}
                >
                  {shortenHex(receiver)}
                </Text>
                <XStack
                  cursor="pointer"
                  onPress={() => {
                    setStringAsync(`${chain.blockExplorers?.default.url}/tx/${item.transactionHash}`).catch(
                      reportError,
                    );
                    toast.show("Link copied!", { native: true, duration: 1000, burntOptions: { haptic: "success" } });
                  }}
                >
                  <Copy size="$iconSize.md" strokeWidth="$iconStroke.md" color="$interactiveBaseBrandDefault" />
                </XStack>
              </XStack>
            )}
          </XStack>
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Amount received
            </Text>
            <XStack alignItems="center" gap="$s3">
              <AssetLogo uri={assetLogos.USDC} width={20} height={20} />
              <Text callout color="$uiNeutralPrimary">
                {Number(assets / 1e6).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: currency === "USDC" ? 2 : 8,
                })}
              </Text>
            </XStack>
          </XStack>
        </YStack>
      </YStack>
      <YStack gap="$s4">
        <YStack gap="$s4">
          <Text emphasized headline>
            Payment details
          </Text>
          <Separator height={1} borderColor="$borderNeutralSoft" />
        </YStack>
        <YStack gap="$s3_5">
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Protocol fee
            </Text>
            <XStack alignItems="center" gap="$s3">
              <AssetLogo uri={assetLogos.USDC} width={20} height={20} />
              <Text callout color="$uiNeutralPrimary">
                {Number(fee / 1e6).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: currency === "USDC" ? 2 : 8,
                })}
              </Text>
            </XStack>
          </XStack>
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Total
            </Text>
            <XStack alignItems="center" gap="$s3">
              <AssetLogo uri={assetLogos.USDC} width={20} height={20} />
              <Text callout color="$uiNeutralPrimary">
                {Number(Number(assets + fee) / 1e6).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: currency === "USDC" ? 2 : 8,
                })}
              </Text>
            </XStack>
          </XStack>
          <XStack justifyContent="space-between">
            <Text emphasized footnote color="$uiNeutralSecondary">
              Due date
            </Text>
            <Text callout color="$uiNeutralPrimary">
              {format(maturity * 1000, "yyyy-MM-dd")}
            </Text>
          </XStack>
        </YStack>
      </YStack>
    </YStack>
  );
}
