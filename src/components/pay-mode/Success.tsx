import { exaPluginAddress } from "@exactly/common/generated/chain";
import type { Address } from "@exactly/common/validation";
import { Check, Loader } from "@tamagui/lucide-icons";
import { format, isAfter } from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { Pressable, Image } from "react-native";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import TransactionDetails from "./TransactionDetails";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Success({
  usdAmount,
  amount,
  currency,
  maturity,
  selectedAsset,
}: {
  usdAmount: number;
  amount: number;
  currency?: string;
  maturity: string;
  selectedAsset: Address;
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
          <View fullScreen>
            <ScrollView
              fullscreen
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
                        <Loader size={48} color="$uiInfoSecondary" strokeWidth={2} />
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
                        {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
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
                  <Pressable
                    onPress={() => {
                      router.replace(isLatestPlugin ? "/(app)/pending-proposals" : "/pay-mode");
                    }}
                  >
                    <Text emphasized footnote color="$uiBrandSecondary">
                      Close
                    </Text>
                  </Pressable>
                </YStack>
              </View>
            </ScrollView>
          </View>
        </View>
      </SafeView>
    </View>
  );
}

const StyledGradient = styled(LinearGradient, {});
