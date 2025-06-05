import { previewerAddress } from "@exactly/common/generated/chain";
import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, useTheme } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import AssetList from "./AssetList";
import { useReadPreviewerExactly } from "../../generated/contracts";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Portfolio() {
  const theme = useTheme();
  const { presentArticle } = useIntercom();
  const { canGoBack } = router;
  const { address } = useAccount();

  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };

  function back() {
    router.back();
  }

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
        {canGoBack() && (
          <Pressable onPress={back}>
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
        )}
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
      </ScrollView>
    </SafeView>
  );
}
