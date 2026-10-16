import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { Spinner } from "tamagui";

import { getAddress } from "viem";
import { useReadContracts } from "wagmi";

import AssetRow from "./AssetRow";
import AssetSection from "./AssetSection";
import formatTokenAmount from "../../utils/formatTokenAmount";
import { presentArticle } from "../../utils/intercom";
import { stockAbi, toShares } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import Text from "../shared/Text";

import type { ExternalAsset } from "../../utils/usePortfolio";

export default function Stocks({
  assets,
  pending = false,
  titled = false,
}: {
  assets: ExternalAsset[];
  pending?: boolean;
  titled?: boolean;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const { data: multipliers } = useReadContracts({
    contracts: assets.map(({ address, chainId }) => ({
      chainId,
      address: getAddress(address),
      abi: stockAbi,
      functionName: "multiplier",
    })),
  });
  if (assets.length === 0) {
    if (titled) return null;
    return pending ? (
      <Spinner color="$interactiveOnBaseBrandSoft" padding="$s6" />
    ) : (
      <Text footnote color="$uiNeutralSecondary" textAlign="center" padding="$s6">
        {t("You don't hold any tokenized stocks yet.")}
      </Text>
    );
  }
  return (
    <AssetSection
      title={titled ? t("Tokenized stocks") : undefined}
      onInfoPress={() => {
        presentArticle("17155255").catch(reportError);
      }}
    >
      {assets.map((asset, index) => {
        const shares = toShares(asset.amount ?? 0n, asset.decimals, multipliers?.[index]?.result);
        return (
          <AssetRow
            key={asset.address}
            address={asset.address}
            chainId={asset.chainId}
            symbol={asset.symbol}
            uri={asset.logoURI}
            name={`${asset.name} (${asset.symbol})`}
            balance={
              shares === undefined
                ? `${formatTokenAmount(asset.amount ?? 0n, asset.decimals, language)} ${asset.symbol}`
                : t("{{amount}} shares", {
                    count: shares,
                    amount: shares.toLocaleString(language, { maximumFractionDigits: 4 }),
                  })
            }
            value={asset.usdValue}
            onPress={() => {
              selectionAsync().catch(reportError);
              router.push({ pathname: "/asset", params: { chainId: String(asset.chainId), address: asset.address } });
            }}
          />
        );
      })}
    </AssetSection>
  );
}
