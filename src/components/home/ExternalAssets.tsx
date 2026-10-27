import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { useQuery } from "@tanstack/react-query";

import chain, { alchemyChains } from "@exactly/common/generated/chain";

import AssetRow from "./AssetRow";
import AssetSection from "./AssetSection";
import ExternalAssetsSheet from "./ExternalAssetsSheet";
import MarketRow from "./MarketRow";
import { isUnsupported, requestDeployment } from "../../utils/deployedOptions";
import formatTokenAmount from "../../utils/formatTokenAmount";
import { lifiChainsOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useDeployments from "../../utils/useDeployments";
import exaConfig from "../../utils/wagmi/exa";
import { Trend } from "../shared/PriceChart";
import UnsupportedSheet from "../shared/UnsupportedSheet";

import type { ExternalAsset, PortfolioAsset } from "../../utils/usePortfolio";

export default function ExternalAssets({ assets }: { assets: PortfolioAsset[] }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { address: exaAccount } = useAccount({ config: exaConfig });
  const { data: lifiChains } = useQuery(lifiChainsOptions);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const [pendingUnsupported, setPendingUnsupported] = useState<null | { asset: ExternalAsset; chainName: string }>(
    null,
  );

  const crossChainIds = [
    ...new Set(
      assets
        .flatMap((asset) => (asset.type === "external" ? [asset.chainId] : []))
        .filter((chainId) => chainId !== chain.id && alchemyChains.has(chainId)),
    ),
  ];

  const { deployedChains, pendingChains, deployableChains } = useDeployments(exaAccount, crossChainIds);

  if (assets.length === 0) return null;

  return (
    <>
      <AssetSection title={t("Other assets")} onInfoPress={() => setInfoSheetOpen(true)}>
        {assets.map((asset) => {
          if (asset.type === "protocol") {
            return (
              <MarketRow
                key={asset.market}
                asset={asset.asset}
                decimals={asset.decimals}
                floatingDepositAssets={asset.floatingDepositAssets}
                market={asset.market}
                symbol={asset.symbol}
                value={asset.usdValue}
              >
                <Trend chainId={chain.id} address={asset.asset} symbol={asset.symbol} />
              </MarketRow>
            );
          }
          const unsupported = isUnsupported(asset.chainId, deployedChains);
          return (
            <AssetRow
              key={`${asset.chainId}:${asset.address}`}
              chainId={asset.chainId}
              symbol={asset.symbol}
              uri={asset.logoURI}
              name={asset.symbol}
              balance={`${formatTokenAmount(asset.amount ?? 0n, asset.decimals, language)} ${asset.symbol}`}
              value={asset.usdValue}
              disabled={unsupported}
              pending={pendingChains.has(asset.chainId)}
              onPress={() => {
                if (!exaAccount) return;
                if (deployableChains.has(asset.chainId)) {
                  requestDeployment(t, exaAccount, asset.chainId).catch(reportError);
                  return;
                }
                if (unsupported) {
                  setPendingUnsupported({
                    asset,
                    chainName: lifiChains?.find(({ id }) => id === asset.chainId)?.name ?? `Chain ${asset.chainId}`,
                  });
                  return;
                }
                selectionAsync().catch(reportError);
                router.push({ pathname: "/asset", params: { chainId: String(asset.chainId), address: asset.address } });
              }}
            >
              <Trend chainId={asset.chainId} address={asset.address} symbol={asset.symbol} />
            </AssetRow>
          );
        })}
      </AssetSection>
      <ExternalAssetsSheet open={infoSheetOpen} onClose={() => setInfoSheetOpen(false)} />
      <UnsupportedSheet
        open={pendingUnsupported !== null}
        asset={pendingUnsupported?.asset}
        chainName={pendingUnsupported?.chainName}
        onClose={() => {
          setPendingUnsupported(null);
        }}
      />
    </>
  );
}
