import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { useQueries, useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import AssetRow from "./AssetRow";
import AssetSection from "./AssetSection";
import ExternalAssetsSheet from "./ExternalAssetsSheet";
import alchemyChainById from "../../utils/alchemyChains";
import deployedOptions, { isUnsupported } from "../../utils/deployedOptions";
import formatTokenAmount from "../../utils/formatTokenAmount";
import { lifiChainsOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import exaConfig from "../../utils/wagmi/exa";
import UnsupportedNetworksSheet from "../shared/UnsupportedNetworksSheet";

import type { ExternalAsset } from "../../utils/usePortfolio";

export default function ExternalAssets({ assets }: { assets: ExternalAsset[] }) {
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
      assets.map(({ chainId }) => chainId).filter((chainId) => chainId !== chain.id && alchemyChainById.has(chainId)),
    ),
  ];

  const { deployedChains, pendingChains } = useQueries({
    queries: crossChainIds.map((chainId) => deployedOptions(exaAccount, chainId)),
    combine: (results) => {
      const pending = new Set<number>();
      const deployed = new Map<number, boolean>();
      for (const [index, chainId] of crossChainIds.entries()) {
        const result = results[index];
        if (!result) continue;
        if (result.isSuccess && typeof result.data === "boolean") deployed.set(chainId, result.data);
        else if (result.isLoading || result.isFetching) pending.add(chainId);
      }
      return { deployedChains: deployed, pendingChains: pending };
    },
  });

  if (assets.length === 0) return null;

  return (
    <>
      <AssetSection title={t("Other assets")} onInfoPress={() => setInfoSheetOpen(true)}>
        {assets.map((asset) => {
          const unsupported = isUnsupported(asset.chainId, deployedChains);
          return (
            <AssetRow
              key={`${asset.chainId}:${asset.address}`}
              address={asset.address}
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
            />
          );
        })}
      </AssetSection>
      <ExternalAssetsSheet open={infoSheetOpen} onClose={() => setInfoSheetOpen(false)} />
      <UnsupportedNetworksSheet
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
