import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { Spinner } from "tamagui";

import { getAddress } from "viem";
import { useReadContracts } from "wagmi";

import chain from "@exactly/common/generated/chain";

import AssetRow from "./AssetRow";
import AssetSection from "./AssetSection";
import formatTokenAmount from "../../utils/formatTokenAmount";
import { stockAbi, toShares } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import { Trend } from "../shared/PriceChart";
import Text from "../shared/Text";

import type { PortfolioAsset } from "../../utils/usePortfolio";

export default function Stocks({
  assets,
  pending = false,
  titled = false,
}: {
  assets: PortfolioAsset[];
  pending?: boolean;
  titled?: boolean;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const holdings = assets.map((asset) =>
    asset.type === "protocol"
      ? {
          key: asset.market,
          address: asset.asset,
          amount: asset.floatingDepositAssets,
          chainId: chain.id,
          decimals: asset.decimals,
          logoURI: undefined,
          market: asset.market,
          name: asset.assetName,
          symbol: asset.symbol,
          usdValue: asset.usdValue,
        }
      : {
          key: `${asset.chainId}:${asset.address}`,
          address: asset.address,
          amount: asset.amount ?? 0n,
          chainId: asset.chainId,
          decimals: asset.decimals,
          logoURI: asset.logoURI,
          market: undefined,
          name: asset.name,
          symbol: asset.symbol,
          usdValue: asset.usdValue,
        },
  );
  const { data: multipliers } = useReadContracts({
    contracts: holdings.map(({ address, chainId }) => ({
      chainId,
      address: getAddress(address),
      abi: stockAbi,
      functionName: "multiplier",
    })),
  });
  if (assets.length === 0) {
    if (titled) return null;
    return pending ? (
      <Spinner color="interactiveOnBaseBrandSoft" padding="s6" />
    ) : (
      <Text footnote color="uiNeutralSecondary" textAlign="center" padding="s6">
        {t("You don't hold any tokenized stocks yet.")}
      </Text>
    );
  }
  return (
    <AssetSection
      title={titled ? t("Tokenized stocks") : undefined}
      description={t("Tradable 24/7. These can’t be used with your Exa Card or as collateral.")}
    >
      {holdings.map(({ key, address, amount, chainId, decimals, logoURI, market, name, symbol, usdValue }, index) => {
        const shares = toShares(amount, decimals, multipliers?.[index]?.result);
        return (
          <AssetRow
            key={key}
            chainId={chainId}
            symbol={symbol}
            uri={logoURI}
            name={`${name} (${symbol})`}
            balance={
              shares === undefined
                ? `${formatTokenAmount(amount, decimals, language)} ${symbol}`
                : t("{{amount}} shares", {
                    count: shares,
                    amount: shares.toLocaleString(language, { maximumFractionDigits: 4 }),
                  })
            }
            value={usdValue}
            onPress={() => {
              selectionAsync().catch(reportError);
              router.push({
                pathname: "/asset",
                params: market ? { chainId: String(chainId), address, market } : { chainId: String(chainId), address },
              });
            }}
          >
            <Trend chainId={chainId} address={address} symbol={symbol} />
          </AssetRow>
        );
      })}
    </AssetSection>
  );
}
