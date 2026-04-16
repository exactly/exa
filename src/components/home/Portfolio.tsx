import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { RefreshControl } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import AssetList from "./AssetList";
import ExternalAssets from "./ExternalAssets";
import { presentArticle } from "../../utils/intercom";
import { balancesOptions } from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useMarkets from "../../utils/useMarkets";
import usePortfolio from "../../utils/usePortfolio";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";
import WeightedRate from "../shared/WeightedRate";

export default function Portfolio() {
  const { address } = useAccount();
  const { averageRate, portfolio, totalBalanceUSD, isPending } = usePortfolio();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { balanceUSD } = portfolio;

  const { refetch: refetchMarkets, isFetching: isFetchingMarkets } = useMarkets();
  const { refetch: refetchBalances, isFetching: isFetchingBalances } = useQuery(balancesOptions(address));

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
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/(main)/(home)");
            }
          }}
        />
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle("10985188").catch(reportError);
          }}
        />
      </View>
      <ScrollView
        backgroundColor="transparent"
        contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isFetchingMarkets || isFetchingBalances}
            onRefresh={() => {
              if (!address) return;
              refetchMarkets().catch(reportError);
              refetchBalances().catch(reportError);
            }}
          />
        }
      >
        {isPending ? (
          <YStack key="portfolio-skeleton">
            <View
              backgroundColor="$backgroundSoft"
              paddingHorizontal="$s4"
              paddingVertical="$s5"
              gap="$s5"
              alignItems="center"
            >
              <Skeleton height={15} width={100} />
              <Skeleton height={40} width={180} />
              <Skeleton height={28} width={90} radius="round" />
            </View>
            <View padded gap="$s4">
              <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s3">
                <Skeleton height={20} width={130} />
                {Array.from({ length: 3 }, (_, index) => (
                  <XStack key={index} alignItems="center" paddingVertical="$s3_5" gap="$s3_5">
                    <Skeleton height={32} width={32} radius="round" />
                    <YStack gap="$s2" flex={1}>
                      <Skeleton height={15} width={50} />
                      <Skeleton height={12} width={70} />
                    </YStack>
                    <YStack gap="$s2" alignItems="flex-end" flex={1}>
                      <Skeleton height={15} width={50} />
                      <Skeleton height={12} width={30} />
                    </YStack>
                    <YStack gap="$s2" alignItems="flex-end" flex={1}>
                      <Skeleton height={15} width={60} />
                      <Skeleton height={12} width={50} />
                    </YStack>
                  </XStack>
                ))}
              </YStack>
              <YStack backgroundColor="$backgroundSoft" borderRadius="$r3" padding="$s4" gap="$s3">
                <Skeleton height={20} width={160} />
                <XStack alignItems="center" gap="$s3_5">
                  <Skeleton height={12} width={60} />
                  <View flex={1} height={1} backgroundColor="$borderNeutralSoft" />
                </XStack>
                {Array.from({ length: 2 }, (_, index) => (
                  <XStack key={index} alignItems="center" paddingVertical="$s3_5" gap="$s3">
                    <Skeleton height={32} width={32} radius="round" />
                    <YStack gap="$s2" width={80}>
                      <Skeleton height={15} width={50} />
                      <Skeleton height={12} width={60} />
                    </YStack>
                    <YStack gap="$s2" flex={1} alignItems="flex-end">
                      <Skeleton height={15} width={60} />
                      <Skeleton height={12} width={80} />
                    </YStack>
                  </XStack>
                ))}
              </YStack>
            </View>
          </YStack>
        ) : (
          <YStack
            key="portfolio-content"
            animation="default"
            enterStyle={{ opacity: 0, transform: [{ translateY: 20 }] }}
            transform={[{ translateY: 0 }]}
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
                mono
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
            <View padded gap="$s4">
              <AssetList />
              <ExternalAssets />
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
          </YStack>
        )}
      </ScrollView>
    </SafeView>
  );
}
