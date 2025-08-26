import { previewerAddress } from "@exactly/common/generated/chain";
import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import AssetList from "./AssetList";
import type { AppNavigationProperties } from "../../app/(app)/_layout";
import { useReadPreviewerExactly } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import useOpenBrowser from "../../utils/useOpenBrowser";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Portfolio() {
  const theme = useTheme();
  const { address } = useAccount();
  const openBrowser = useOpenBrowser();
  const { presentArticle } = useIntercom();
  const navigation = useNavigation<AppNavigationProperties>();
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };

  const {
    data: markets,
    refetch: refetchMarkets,
    isFetching: isFetchingMarkets,
  } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });

  let usdBalance = 0n;
  if (markets) {
    for (const market of markets) {
      if (market.floatingDepositAssets > 0n) {
        usdBalance += (market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals);
      }
    }
  }

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View padded flexDirection="row" gap={10} paddingBottom="$s4" justifyContent="space-between" alignItems="center">
        <Pressable
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.replace("(home)", { screen: "index" });
            }
          }}
        >
          <ArrowLeft size={24} color="$uiNeutralPrimary" />
        </Pressable>
        <Pressable
          onPress={() => {
            presentArticle("10985188").catch(reportError);
          }}
        >
          <CircleHelp color="$uiNeutralPrimary" />
        </Pressable>
      </View>

      <ScrollView
        backgroundColor="$backgroundMild"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            style={style}
            refreshing={isFetchingMarkets}
            onRefresh={() => {
              refetchMarkets().catch(reportError);
            }}
          />
        }
      >
        <View
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s4"
          paddingVertical="$s5"
          gap="$s4"
          alignItems="center"
        >
          <Text emphasized subHeadline color="$uiNeutralSecondary">
            Your Portfolio
          </Text>
          <Text
            sensitive
            textAlign="center"
            fontFamily="$mono"
            fontSize={40}
            overflow="hidden"
            maxFontSizeMultiplier={1}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {(Number(usdBalance) / 1e18).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
              currencyDisplay: "narrowSymbol",
            })}
          </Text>
        </View>
        <View padded>
          <AssetList />
        </View>
        <XStack gap="$s4" padding="$s4" flexWrap="wrap">
          <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
            Yield is variable, not guaranteed, and powered by&nbsp;
            <Text
              cursor="pointer"
              caption2
              color="$interactiveOnDisabled"
              textDecorationLine="underline"
              onPress={() => {
                openBrowser(`https://exact.ly/`).catch(reportError);
              }}
            >
              Exactly Protocol
            </Text>
            . Returns depend on protocol performance and network activity. Past performance does not guarantee future
            results.
          </Text>
        </XStack>
      </ScrollView>
    </SafeView>
  );
}
