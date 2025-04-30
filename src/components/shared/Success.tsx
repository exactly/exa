import { exaPluginAddress, marketUSDCAddress } from "@exactly/common/generated/chain";
import type { Hex } from "@exactly/common/validation";
import { Check } from "@tamagui/lucide-icons";
import { format, isAfter } from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, Image } from "react-native";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

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
  const theme = useTheme();
  const { externalAsset } = useAsset(selectedAsset);
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  return (
    <View fullScreen backgroundColor="$backgroundSoft">
      <StyledGradient
        locations={[0.5, 1]}
        position="absolute"
        top={0}
        left={0}
        right={0}
        height={220}
        opacity={0.2}
        colors={
          isLatestPlugin
            ? [theme.uiInfoSecondary.val, theme.backgroundSoft.val]
            : [theme.uiSuccessSecondary.val, theme.backgroundSoft.val]
        }
      />
      <SafeView backgroundColor="transparent">
        <View fullScreen padded>
          <ScrollView
            showsVerticalScrollIndicator={false}
            stickyHeaderIndices={[0]}
            // eslint-disable-next-line react-native/no-inline-styles
            contentContainerStyle={{
              flexGrow: 1,
              flexDirection: "column",
              justifyContent: "space-between",
            }}
            stickyHeaderHiddenOnScroll
          >
            <View flex={1}>
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
                        isAfter(new Date(Number(maturity) * 1000), new Date())
                          ? "$uiNeutralPrimary"
                          : "$uiErrorSecondary"
                      }
                    >
                      {`Due ${format(new Date(Number(maturity) * 1000), "MMM dd, yyyy")}`}
                    </Text>
                  </Text>
                  <Text title primary color="$uiNeutralPrimary">
                    {Number(usdAmount).toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      currencyDisplay: "narrowSymbol",
                    })}
                  </Text>
                  <XStack gap="$s2" alignItems="center">
                    <Text emphasized secondary subHeadline>
                      {Number(amount).toLocaleString(undefined, {
                        maximumFractionDigits: selectedAsset && selectedAsset === marketUSDCAddress ? 2 : 8,
                      })}
                    </Text>
                    <Text emphasized secondary subHeadline>
                      &nbsp;{currency}&nbsp;
                    </Text>
                    {externalAsset ? (
                      <Image source={{ uri: externalAsset.logoURI }} width={16} height={16} borderRadius={20} />
                    ) : (
                      <AssetLogo uri={assetLogos[currency as keyof typeof assetLogos]} width={16} height={16} />
                    )}
                  </XStack>
                </YStack>
              </YStack>
              <TransactionDetails />
            </View>
            <View flex={2} justifyContent="flex-end">
              <YStack alignItems="center" gap="$s4">
                <Pressable onPress={onClose}>
                  <Text emphasized footnote color="$uiBrandSecondary">
                    Close
                  </Text>
                </Pressable>
              </YStack>
            </View>
          </ScrollView>
        </View>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
