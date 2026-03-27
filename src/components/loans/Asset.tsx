import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import queryClient, { type Loan } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Address } from "viem";

export default function Asset() {
  const router = useRouter();
  const { t } = useTranslation();
  const [selectedMarket, setSelectedMarket] = useState<Address>();
  const { markets } = useMarkets();
  return (
    <SafeView fullScreen>
      <View
        padded
        flexDirection="row"
        gap="$s3_5"
        paddingBottom="$s4"
        justifyContent="space-between"
        alignItems="center"
      >
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/loan");
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
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
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s4">
            <YStack>
              <Text primary emphasized body>
                {t("Select the asset to fund")}
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
                        padding="$s2"
                        alignItems="center"
                        justifyContent="center"
                      >
                        {selected && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                      </View>
                      <XStack gap="$s2" alignItems="center">
                        <AssetLogo symbol={assetSymbol} width={16} height={16} />
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
              secondary
              disabled={!selectedMarket}
              onPress={() => {
                queryClient.setQueryData<Loan>(["loan"], (old) => ({ ...old, market: selectedMarket }));
                router.push("/loan/amount");
              }}
            >
              <Button.Text>{t("Continue")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
