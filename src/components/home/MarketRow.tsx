import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import chain from "@exactly/common/generated/chain";

import AssetRow from "./AssetRow";
import formatTokenAmount from "../../utils/formatTokenAmount";
import reportError from "../../utils/reportError";

import type { Hex } from "@exactly/common/validation";

export default function MarketRow({
  asset,
  children,
  decimals,
  floatingDepositAssets,
  market,
  symbol,
  value,
}: {
  asset: Hex;
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
      chainId={chain.id}
      symbol={symbol}
      name={symbol}
      balance={`${formatTokenAmount(floatingDepositAssets, decimals, language)} ${symbol}`}
      value={value}
      onPress={() => {
        selectionAsync().catch(reportError);
        router.push({ pathname: "/asset", params: { chainId: String(chain.id), address: asset, market } });
      }}
    >
      {children}
    </AssetRow>
  );
}
