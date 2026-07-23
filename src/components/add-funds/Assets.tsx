import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ArrowLeft, CircleHelp, Info } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import AddFundsOption from "./AddFundsOption";
import CollateralSheet from "./CollateralSheet";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Assets() {
  const router = useRouter();
  const { t } = useTranslation();
  const { markets, isPending } = useMarkets();
  const [collateralShown, setCollateralShown] = useState(false);
  const assets = useMemo(() => {
    if (!markets) return [];
    const excluded = new Set(["USDC.e", "DAI"]);
    return markets
      .filter((market) => !excluded.has(market.symbol.slice(3)))
      .map((market) =>
        market.symbol.slice(3) === "WETH"
          ? { symbol: "ETH", name: "Ether" }
          : { symbol: market.symbol.slice(3), name: market.assetName },
      );
  }, [markets]);
  return (
    <SafeView fullScreen backgroundColor="$backgroundMild">
      <View gap="$s6" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/add-funds");
              }
            }}
          />
          <Text emphasized subHeadline primary>
            {t("Cryptocurrencies")}
          </Text>
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <ScrollView flex={1} showsVerticalScrollIndicator={false}>
          <YStack gap="$s4">
            <XStack gap="$s2" alignItems="center">
              <Text emphasized primary headline>
                {t("Supported assets")}
              </Text>
              <Pressable hitSlop={15} onPress={() => setCollateralShown(true)}>
                <Info size={16} color="$uiBrandSecondary" />
              </Pressable>
            </XStack>
            <YStack gap="$s3_5">
              {isPending
                ? Array.from({ length: 5 }, (_, index) => <Skeleton key={index} width="100%" height={82} />)
                : assets.map(({ symbol, name }) => (
                    <AddFundsOption
                      key={symbol}
                      icon={<AssetLogo symbol={symbol} width={24} height={24} />}
                      title={symbol}
                      subtitle={name}
                      onPress={() => {
                        router.push({ pathname: "/add-funds/add-crypto", params: { asset: symbol } });
                      }}
                    />
                  ))}
            </YStack>
          </YStack>
        </ScrollView>
        <CollateralSheet
          open={collateralShown}
          onClose={() => {
            setCollateralShown(false);
          }}
        />
      </View>
    </SafeView>
  );
}
