import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import AssetRow from "./AssetRow";
import formatTokenAmount from "../../utils/formatTokenAmount";
import reportError from "../../utils/reportError";

import type { Hex } from "@exactly/common/validation";

export default function MarketRow({
  asset,
  chainId,
  children,
  decimals,
  floatingDepositAssets,
  market,
  symbol,
  value,
}: {
  asset: Hex;
  chainId: number;
  children: ReactNode;
  decimals: number;
  floatingDepositAssets: bigint;
  market: Hex;
  symbol: string;
  value: number;
}) {
  const {
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  return (
    <AssetRow
      chainId={chainId}
      symbol={symbol}
      name={symbol}
      balance={`${formatTokenAmount(floatingDepositAssets, decimals, language)} ${symbol}`}
      value={value}
      onPress={() => {
        selectionAsync().catch(reportError);
        router.push({ pathname: "/asset", params: { chainId: String(chainId), address: asset, market } });
      }}
    >
      {children}
    </AssetRow>
  );
}
