import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { YStack } from "tamagui";

import chain, { allowlists } from "@exactly/common/generated/chain";

import { AssetRow } from "./ExternalAssets";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import usePortfolio from "../../utils/usePortfolio";
import Text from "../shared/Text";
import { defaultSwap, type Swap } from "../swaps/Swaps";

export default function Stocks() {
  const { t } = useTranslation();
  const router = useRouter();
  const { externalAssets } = usePortfolio();
  const stocks = externalAssets.filter(({ address }) => stockAddresses.has(address.toLowerCase()));
  if (stocks.length === 0) return null;
  return (
    <YStack
      animation="default"
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

const stockAddresses = new Set(
  (allowlists[String(chain.id)] ?? [])
    .map((address) => address.toLowerCase())
    .filter((address) => address.startsWith("0xb200000000000000000000")),
);
