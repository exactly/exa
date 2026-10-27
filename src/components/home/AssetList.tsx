import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import AssetSection from "./AssetSection";
import CollateralAssetsSheet from "./CollateralAssetsSheet";
import MarketRow from "./MarketRow";
import useMarkets from "../../utils/useMarkets";
import Rate from "../shared/Rate";

export default function AssetList({
  rates,
  titled = false,
}: {
  rates: { market: string; rate: bigint }[];
  titled?: boolean;
}) {
  const { t } = useTranslation();
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
            rate: rates.find(({ market: address }) => address === market.market)?.rate,
            symbol: market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3),
            usdValue: Number((market.floatingDepositAssets * market.usdPrice) / BigInt(10 ** market.decimals)) / 1e18,
          }))
          .filter((market) => !market.nonCollateral && (!market.isFrozen || market.floatingDepositAssets > 0n))
          .sort((a, b) => b.usdValue - a.usdValue)
          .map((market) => (
            <MarketRow
              key={market.asset}
              asset={market.asset}
              decimals={market.decimals}
              floatingDepositAssets={market.floatingDepositAssets}
              market={market.market}
              symbol={market.symbol}
              value={market.usdValue}
            >
              {market.rate === undefined ? null : <Rate compact rate={market.rate} />}
            </MarketRow>
          ))}
      </AssetSection>
      <CollateralAssetsSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}
