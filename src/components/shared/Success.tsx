import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import type { Hex } from "@exactly/common/validation";
import { Check } from "@tamagui/lucide-icons";
import { format, isAfter } from "date-fns";
import React from "react";
import { Square, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import GradientScrollView from "./GradientScrollView";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";

export default function Success({
  usdAmount,
  amount,
  currency,
  maturity,
  selectedAsset,
  onClose,
}: {
  usdAmount: number;
  amount: number;
  currency?: string;
  maturity: bigint;
  selectedAsset?: Hex;
  onClose: () => void;
}) {
  const { externalAsset } = useAsset(selectedAsset);
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  return (
    <GradientScrollView variant="success">
      <YStack gap="$s5" justifyContent="space-between">
        <YStack>
          <YStack gap="$s7" paddingBottom="$s9">
            <XStack justifyContent="center" alignItems="center">
              <Square
                borderRadius="$r4"
                backgroundColor={
                  isLatestPlugin ? "$interactiveBaseInformationSoftDefault" : "$interactiveBaseSuccessSoftDefault"
                }
                size={80}
              >
                {isLatestPlugin ? (
                  <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />
                ) : (
                  <Check size={48} color="$uiSuccessSecondary" strokeWidth={2} />
                )}
              </Square>
            </XStack>
            <YStack gap="$s4_5" justifyContent="center" alignItems="center">
              <Text secondary body>
                {isLatestPlugin ? "Processing" : "Paid"}&nbsp;
                <Text
                  emphasized
                  primary
                  body
                  color={
                    isAfter(new Date(Number(maturity) * 1000), new Date()) ? "$uiNeutralPrimary" : "$uiErrorSecondary"
                  }
                >
                  {`Due ${format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}`}
                </Text>
              </Text>
              <Text title primary color="$uiNeutralPrimary">
                {usdAmount.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  currencyDisplay: "narrowSymbol",
                })}
              </Text>
              <XStack gap="$s2" alignItems="center">
                <Text emphasized secondary subHeadline>
                  {amount.toLocaleString(undefined, {
                    maximumFractionDigits: selectedAsset && selectedAsset === marketUSDCAddress ? 2 : 8,
                  })}
                </Text>
                <Text emphasized secondary subHeadline>
                  &nbsp;{currency}&nbsp;
                </Text>
                <AssetLogo
                  {...(externalAsset
                    ? {
                        external: true,
                        source: { uri: externalAsset.logoURI },
                        width: 16,
                        height: 16,
                        borderRadius: 20,
                      }
                    : { uri: assetLogos[currency as keyof typeof assetLogos], width: 16, height: 16 })}
                />
              </XStack>
            </YStack>
          </YStack>
          <TransactionDetails />
        </YStack>
      </YStack>
      <YStack onPress={onClose} cursor="pointer" hitSlop={20} alignSelf="center">
        <Text emphasized footnote color="$uiBrandSecondary">
          Close
        </Text>
      </YStack>
    </GradientScrollView>
  );
}
