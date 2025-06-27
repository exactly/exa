import shortenHex from "@exactly/common/shortenHex";
import { X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";

import type { WithdrawDetails } from "./Amount";
import assetLogos from "../../utils/assetLogos";
import type { Withdraw } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

export default function Failure({
  details: { name: assetName, amount, usdValue },
  hash,
  onClose,
}: {
  details: WithdrawDetails;
  hash?: string;
  onClose: () => void;
}) {
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { externalAsset } = useAsset(withdraw?.market);
  const theme = useTheme();
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
        colors={[theme.uiErrorSecondary.val, theme.backgroundSoft.val]}
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
                  <Square borderRadius="$r4" backgroundColor="$interactiveBaseErrorSoftDefault" size={80}>
                    <X size={48} color="$uiErrorSecondary" strokeWidth={2} />
                  </Square>
                </XStack>
                <YStack gap="$s4_5" justifyContent="center" alignItems="center">
                  <Text secondary body>
                    Failed&nbsp;
                    <Text emphasized primary body color="$uiNeutralPrimary">
                      {shortenHex(withdraw?.receiver ?? "", 3, 5)}
                    </Text>
                  </Text>
                  <Text title primary color="$uiNeutralPrimary">
                    {Number(usdValue).toLocaleString(undefined, {
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
                      &nbsp;{assetName}&nbsp;
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
                        : { uri: assetLogos[assetName as keyof typeof assetLogos], width: 16, height: 16 })}
                    />
                  </XStack>
                </YStack>
              </YStack>
              <TransactionDetails hash={hash} />
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
