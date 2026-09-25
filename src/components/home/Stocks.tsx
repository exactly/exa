import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { YStack } from "tamagui";

import { AssetRow } from "./ExternalAssets";
import { isStock } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import usePortfolio from "../../utils/usePortfolio";
import Text from "../shared/Text";
import { defaultSwap, type Swap } from "../swaps/Swaps";

export default function Stocks() {
  const { t } = useTranslation();
  const router = useRouter();
  const { externalAssets, crossChainAssets } = usePortfolio();
  const stocks = [...externalAssets, ...crossChainAssets].filter(isStock);
  if (stocks.length === 0) return null;
  return (
    <YStack
      transition="default"
      enterStyle={{ opacity: 0, transform: [{ translateY: 20 }] }}
      transform={[{ translateY: 0 }]}
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      padding="$s4"
      gap="$s3"
    >
      <Text emphasized headline color="$uiNeutralPrimary">
        {t("Tokenized stocks")}
      </Text>
      {stocks.map((asset) => (
        <AssetRow
          key={asset.address}
          asset={asset}
          onPress={() => {
            selectionAsync().catch(reportError);
            queryClient.setQueryData<Swap>(["swap"], { ...defaultSwap, fromToken: { external: true, token: asset } });
            router.push("/swaps");
          }}
        />
      ))}
    </YStack>
  );
}
