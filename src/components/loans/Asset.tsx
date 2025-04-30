import { previewerAddress } from "@exactly/common/generated/chain";
import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadPreviewerExactly } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import queryClient, { type Loan } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Asset() {
  const { canGoBack } = router;
  const { address } = useAccount();
  const { presentArticle } = useIntercom();
  const [selectedMarket, setSelectedMarket] = useState<string>();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  return (
    <SafeView fullScreen>
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (canGoBack()) {
              router.back();
              return;
            }
            router.replace("/");
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
        <Text primary emphasized subHeadline>
          Estimate loan terms
        </Text>
        <Pressable
          onPress={() => {
            presentArticle("11541409").catch(reportError);
          }}
        >
          <CircleHelp color="$uiNeutralPrimary" />
        </Pressable>
      </View>
      <ScrollView
        backgroundColor="$backgroundMild"
        showsVerticalScrollIndicator={false}
        // eslint-disable-next-line react-native/no-inline-styles
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s4">
            <YStack>
              <Text primary emphasized body>
                Select the asset to borrow
              </Text>
            </YStack>
            <YStack gap="$s3">
              {markets
                // TODO enable borrows in other assets
                // ({ symbol }) => symbol.slice(3) !== "USDC.e" && symbol.slice(3) !== "DAI")
                ?.filter(({ symbol }) => symbol.slice(3) === "USDC")
                .map(({ market, symbol }) => {
                  const assetSymbol = symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3);
                  const selected = selectedMarket === market;
                  return (
                    <XStack
                      key={market}
                      gap="$s3_5"
                      alignItems="center"
                      cursor="pointer"
                      backgroundColor={selected ? "$interactiveBaseBrandSoftDefault" : "$backgroundSoft"}
                      borderRadius="$r3"
                      paddingHorizontal="$s4"
                      paddingVertical="$s4_5"
                      onPress={() => {
                        if (selectedMarket !== market) setSelectedMarket(market);
                      }}
                    >
                      <View
                        width={16}
                        height={16}
                        backgroundColor={selected ? "$interactiveBaseBrandDefault" : "$uiNeutralSecondary"}
                        borderRadius="$r_0"
                        padding={4}
                        alignItems="center"
                        justifyContent="center"
                      >
                        {selected && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                      </View>
                      <XStack gap="$s2" alignItems="center">
                        <AssetLogo uri={assetLogos[assetSymbol as keyof typeof assetLogos]} width={16} height={16} />
                        <Text primary emphasized body>
                          {assetSymbol}
                        </Text>
                      </XStack>
                    </XStack>
                  );
                })}
            </YStack>
          </YStack>
          <YStack>
            <Button
              onPress={() => {
                queryClient.setQueryData(["loan"], (old: Loan) => ({ ...old, market: selectedMarket }));
                router.push("/(app)/loan/amount");
              }}
              main
              spaced
              outlined
              disabled={!selectedMarket}
              backgroundColor={selectedMarket ? "$interactiveBaseBrandSoftDefault" : "$interactiveDisabled"}
              color={selectedMarket ? "$interactiveOnBaseBrandSoft" : "$interactiveOnDisabled"}
              iconAfter={
                <ArrowRight
                  color={selectedMarket ? "$interactiveOnBaseBrandSoft" : "$interactiveOnDisabled"}
                  strokeWidth={2.5}
                />
              }
              flex={0}
            >
              Continue
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
