import React, { useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowLeft, BriefcaseBusiness, ChartNoAxesCombined, CircleHelp, ShieldCheck } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import AssetList from "./AssetList";
import ExternalAssets from "./ExternalAssets";
import Stocks from "./Stocks";
import { revalidateUnsupported } from "../../utils/deployedOptions";
import { presentArticle } from "../../utils/intercom";
import { balancesOptions, isStock } from "../../utils/lifi";
import openBrowser from "../../utils/openBrowser";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useMarkets from "../../utils/useMarkets";
import usePortfolio, { type ExternalAsset } from "../../utils/usePortfolio";
import Amount from "../shared/Amount";
import IconButton from "../shared/IconButton";
import Rate from "../shared/Rate";
import RefreshControl from "../shared/RefreshControl";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Tabs from "../shared/Tabs";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Portfolio() {
  const { address } = useAccount();
  const { averageRate, rates, portfolio, totalBalanceUSD, allAssets, isPending } = usePortfolio();
  const router = useRouter();
  const { t } = useTranslation();
  const [tab, setTab] = useState<"all" | "collateral" | "stocks">("all");

  const { refetch: refetchMarkets } = useMarkets();
  const { refetch: refetchBalances, isFetching: isBalancesFetching } = useQuery(balancesOptions(address));

  const stocks = allAssets.filter((asset): asset is ExternalAsset => asset.type === "external" && isStock(asset));

  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View padded flexDirection="row" gap="$s3_5" paddingBottom="$s4" alignItems="center">
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.dismissTo("/(main)/(home)");
            }
          }}
        />
        <Text flex={1} emphasized subHeadline textAlign="center" color="$uiNeutralPrimary">
          {t("Portfolio")}
        </Text>
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle("10985188").catch(reportError);
          }}
        />
      </View>
      <ScrollView
        backgroundColor="$backgroundSoft"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            onRefresh={() =>
              address ? Promise.all([refetchMarkets(), refetchBalances(), revalidateUnsupported()]) : Promise.resolve()
            }
          />
        }
      >
        <YStack paddingTop="$s5" gap="$s6" alignItems="center">
          {isPending ? (
            <YStack key="portfolio-skeleton" gap="$s4_5" alignItems="center">
              <Skeleton height={40} width={180} />
              <Skeleton height={20} width={100} />
            </YStack>
          ) : (
            <YStack key={tab} gap="$s4_5" alignItems="center" transition="default" enterStyle={{ opacity: 0 }}>
              <Amount
                amount={
                  {
                    all: Number(totalBalanceUSD) / 1e18,
                    collateral: Number(portfolio.collateralUSD) / 1e18,
                    stocks: stocks.reduce((sum, asset) => sum + asset.usdValue, 0),
                  }[tab]
                }
              />
              {tab !== "stocks" && portfolio.collateralUSD > 0n ? (
                <Rate
                  rate={averageRate}
                  onPress={() => {
                    presentArticle("12633694").catch(reportError);
                  }}
                />
              ) : null}
            </YStack>
          )}
          <Tabs
            items={[
              { key: "all", label: t("All"), Icon: BriefcaseBusiness },
              { key: "collateral", label: t("Collateral"), Icon: ShieldCheck },
              { key: "stocks", label: t("Stocks"), Icon: ChartNoAxesCombined },
            ]}
            value={tab}
            onChange={setTab}
          />
        </YStack>
        {isPending ? (
          <YStack key="list-skeleton" padding="$s4" paddingTop="$s5" gap="$s6">
            {Array.from({ length: 4 }, (_, index) => (
              <XStack key={index} alignItems="center" gap="$s3_5">
                <Skeleton height={40} width={40} radius="round" />
                <YStack gap="$s2" flex={1}>
                  <Skeleton height={15} width={110} />
                  <Skeleton height={12} width={70} />
                </YStack>
                <YStack gap="$s2" alignItems="flex-end">
                  <Skeleton height={15} width={70} />
                  <Skeleton height={12} width={40} />
                </YStack>
              </XStack>
            ))}
          </YStack>
        ) : (
          <>
            {tab === "stocks" ? null : <AssetList titled={tab === "all"} rates={rates} />}
            {tab === "collateral" ? null : (
              <Stocks titled={tab === "all"} assets={stocks} pending={isBalancesFetching} />
            )}
            {tab === "all" ? (
              <ExternalAssets
                assets={allAssets.filter((asset) =>
                  asset.type === "external" ? !isStock(asset) : asset.nonCollateral,
                )}
              />
            ) : null}
          </>
        )}
        {tab === "stocks" ? null : (
          <View padding="$s4">
            <Text caption2 color="$interactiveOnDisabled">
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
          </View>
        )}
      </ScrollView>
    </SafeView>
  );
}
