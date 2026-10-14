import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import chain from "@exactly/common/generated/chain";

import AssetRow from "./AssetRow";
import AssetSection from "./AssetSection";
import CollateralAssetsSheet from "./CollateralAssetsSheet";
import formatTokenAmount from "../../utils/formatTokenAmount";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";

export default function AssetList({ titled = false }: { titled?: boolean }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { markets } = useMarkets();
  const [sheetOpen, setSheetOpen] = useState(false);

  if (!markets?.length) return null;

  return (
    <>
      <AssetSection
        title={titled ? t("Collateral assets") : undefined}
        onInfoPress={() => {
          setSheetOpen(true);
        }}
      >
        {markets
          .map((market) => ({
            ...market,
            symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            usdValue: Number((market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
          }))
          .filter((market) => market.symbol !== "USDC.e" || market.floatingDepositAssets > 0n)
          .sort((a, b) => b.usdValue - a.usdValue)
          .map((market) => (
            <AssetRow
              key={market.asset}
              address={market.asset}
              chainId={chain.id}
              symbol={market.symbol}
              name={market.symbol}
              balance={`${formatTokenAmount(market.floatingDepositAssets, market.decimals, language)} ${market.symbol}`}
              value={market.usdValue}
              onPress={() => {
                selectionAsync().catch(reportError);
                router.push({
                  pathname: "/asset",
                  params: { chainId: String(chain.id), address: market.asset, market: market.market },
                });
              }}
            />
          ))}
      </AssetSection>
      <CollateralAssetsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
