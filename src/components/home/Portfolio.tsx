import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable, RefreshControl } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack } from "tamagui";

import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";

import AssetList from "./AssetList";
import { presentArticle } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio from "../../utils/usePortfolio";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";
import WeightedRate from "../shared/WeightedRate";

export default function Portfolio() {
  const { address } = useAccount();
  const { averageRate, portfolio, totalBalanceUSD } = usePortfolio();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { balanceUSD } = portfolio;

  const { refetch: refetchMarkets, isFetching: isFetchingMarkets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
      <View
        padded
        flexDirection="row"
        gap="$s3_5"
        paddingBottom="$s4"
        justifyContent="space-between"
        alignItems="center"
      >
        <Pressable
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(main)/(home)");
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
        backgroundColor="transparent"
        contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetchingMarkets}
            onRefresh={() => {
              if (address) refetchMarkets().catch(reportError);
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
            {t("Your Portfolio")}
          </Text>
          <Text
            sensitive
            textAlign="center"
            fontSize={40}
            overflow="hidden"
            maxFontSizeMultiplier={1}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {`$${(Number(totalBalanceUSD) / 1e18).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
          {balanceUSD > 0n ? (
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
            <Trans
              i18nKey="Performance is variable, not guaranteed, and powered by <protocol>Exactly Protocol</protocol>. Yields depend on protocol performance and network activity. Past performance does not guarantee future results."
              components={{
                protocol: (
                  <Text
                    cursor="pointer"
                    caption2
                    color="$interactiveOnDisabled"
                    textDecorationLine="underline"
                    aria-label={t("Exactly protocol website")}
                    role="link"
                    onPress={() => {
                      openBrowser(`https://exact.ly/`).catch(reportError);
                    }}
                  />
                ),
              }}
            />
          </Text>
        </XStack>
      </ScrollView>
    </SafeView>
  );
}
