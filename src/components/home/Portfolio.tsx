import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { useNavigation } from "expo-router";
import React from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack } from "tamagui";
import { zeroAddress } from "viem";

import AssetList from "./AssetList";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useIntercom from "../../utils/useIntercom";
import useOpenBrowser from "../../utils/useOpenBrowser";
import usePortfolio from "../../utils/usePortfolio";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";
import WeightedRate from "../shared/WeightedRate";

export default function Portfolio() {
  const theme = useTheme();
  const { address } = useAccount();
  const openBrowser = useOpenBrowser();
  const { presentArticle } = useIntercom();
  const { averageRate, portfolio } = usePortfolio(address);
  const navigation = useNavigation<AppNavigationProperties>();
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };

  const { usdBalance } = portfolio;

  const { refetch: refetchMarkets, isFetching: isFetchingMarkets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
  });

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
          gap="$s5"
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
          {usdBalance > 0n ? (
            <WeightedRate
              averageRate={averageRate}
              depositMarkets={portfolio.depositMarkets}
              onPress={(event) => {
                event.stopPropagation();
                presentArticle("12633694").catch(reportError);
              }}
            />
          ) : null}
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
