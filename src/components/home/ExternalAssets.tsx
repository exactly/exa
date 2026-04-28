import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { ChevronRight, Info } from "@tamagui/lucide-icons";
import { Spinner, XStack, YStack } from "tamagui";

import { useQueries, useQuery } from "@tanstack/react-query";
import { formatUnits } from "viem";

import chain from "@exactly/common/generated/chain";

import ExternalAssetsSheet from "./ExternalAssetsSheet";
import UnsupportedNetworksSheet from "./UnsupportedNetworksSheet";
import alchemyChainById from "../../utils/alchemyChains";
import deployedOptions from "../../utils/deployedOptions";
import { lifiChainsOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio, { type ExternalAsset } from "../../utils/usePortfolio";
import exaConfig from "../../utils/wagmi/exa";
import AssetLogo from "../shared/AssetLogo";
import ChainLogo from "../shared/ChainLogo";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ExternalAssets() {
  const { t } = useTranslation();
  const router = useRouter();
  const { address: exaAccount } = useAccount({ config: exaConfig });
  const { externalAssets, crossChainAssets } = usePortfolio();
  const { data: lifiChains } = useQuery(lifiChainsOptions);
  const [infoSheetOpen, setInfoSheetOpen] = useState(false);
  const [pendingUnsupported, setPendingUnsupported] = useState<null | { asset: ExternalAsset; chainName: string }>(
    null,
  );

  const groups = useMemo<NetworkGroup[]>(() => {
    const byChain = new Map<number, ExternalAsset[]>();
    for (const asset of [...externalAssets, ...crossChainAssets]) {
      const list = byChain.get(asset.chainId) ?? [];
      list.push(asset);
      byChain.set(asset.chainId, list);
    }
    const chainName = (chainId: number) => {
      if (chainId === chain.id) return chain.name;
      return lifiChains?.find(({ id }) => id === chainId)?.name ?? `Chain ${chainId}`;
    };
    const chainUsd = (assets: ExternalAsset[]) => assets.reduce((sum, asset) => sum + asset.usdValue, 0);
    const next: NetworkGroup[] = [...byChain.entries()]
      .map(([chainId, assets]) => ({
        chainId,
        chainName: chainName(chainId),
        assets: [...assets].sort((a, b) => b.usdValue - a.usdValue),
      }))
      .sort((a, b) => {
        if (a.chainId === chain.id) return -1;
        if (b.chainId === chain.id) return 1;
        return chainUsd(b.assets) - chainUsd(a.assets);
      });
    return next;
  }, [externalAssets, crossChainAssets, lifiChains]);

  const crossChainIds = useMemo(() => {
    const ids = new Set<number>();
    for (const group of groups) {
      if (group.chainId !== chain.id && alchemyChainById.has(group.chainId)) ids.add(group.chainId);
    }
    return [...ids];
  }, [groups]);

  const { deployedChains, pendingChains } = useQueries({
    queries: crossChainIds.map((chainId) => deployedOptions(exaAccount, chainId)),
    combine: (results) => {
      const pending = new Set<number>();
      const deployed = new Map<number, boolean>();
      for (const [index, chainId] of crossChainIds.entries()) {
        const result = results[index];
        if (!result) continue;
        if (typeof result.data === "boolean") deployed.set(chainId, result.data);
        else if (result.isLoading || result.isFetching) pending.add(chainId);
      }
      return { deployedChains: deployed, pendingChains: pending };
    },
  });

  function handleSelect(asset: ExternalAsset) {
    if (!exaAccount) return;
    if (asset.chainId === chain.id) {
      selectionAsync().catch(reportError);
      router.push({ pathname: "/send-funds", params: { asset: asset.address } });
      return;
    }
    if (isUnsupported(asset.chainId, deployedChains)) {
      const group = groups.find(({ chainId }) => chainId === asset.chainId);
      setPendingUnsupported({ asset, chainName: group?.chainName ?? `Chain ${asset.chainId}` });
      return;
    }
    selectionAsync().catch(reportError);
    router.push({
      pathname: "/(main)/add-funds/bridge",
      params: { sender: "exa", sourceChain: String(asset.chainId), sourceToken: asset.address },
    });
  }

  if (groups.length === 0) return null;

  return (
    <>
      <YStack
        key="non-collateral-content"
        animation="default"
        enterStyle={{ opacity: 0, transform: [{ translateY: 20 }] }}
        transform={[{ translateY: 0 }]}
        backgroundColor="$backgroundSoft"
        borderRadius="$r3"
        padding="$s4"
        gap="$s3"
      >
        <XStack alignItems="center" gap="$s2" onPress={() => setInfoSheetOpen(true)}>
          <Text emphasized headline color="$uiNeutralPrimary">
            {t("Non-collateral assets")}
          </Text>
          <Info size={16} color="$interactiveOnBaseBrandSoft" />
        </XStack>
        {groups.map((group, index) => (
          <NetworkSection
            key={group.chainId}
            group={group}
            isFirst={index === 0}
            disabled={isUnsupported(group.chainId, deployedChains)}
            pending={pendingChains.has(group.chainId)}
            onSelect={handleSelect}
          />
        ))}
      </YStack>
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

type NetworkGroup = {
  assets: ExternalAsset[];
  chainId: number;
  chainName: string;
};

function NetworkHeader({ name }: { name: string }) {
  return (
    <XStack alignItems="center" gap="$s3_5">
      <Text emphasized caption2 color="$uiNeutralPlaceholder">
        {name.toUpperCase()}
      </Text>
      <View flex={1} height={1} backgroundColor="$borderNeutralSoft" />
    </XStack>
  );
}

function AssetRow({
  asset,
  disabled,
  onPress,
  pending,
}: {
  asset: ExternalAsset;
  disabled: boolean;
  onPress: () => void;
  pending: boolean;
}) {
  const {
    i18n: { language },
  } = useTranslation();
  const balance = asset.amount ?? 0n;
  const priceUSD = Number(asset.priceUSD);
  const contentOpacity = disabled ? 0.5 : 1;

  return (
    <XStack
      alignItems="center"
      gap="$s3"
      paddingVertical="$s3_5"
      borderRadius="$r3"
      cursor={pending ? "default" : "pointer"}
      pressStyle={pending ? undefined : pressStyle}
      opacity={pending ? 0.7 : 1}
      onPress={pending ? undefined : onPress}
    >
      <View position="relative" opacity={contentOpacity}>
        <AssetLogo height={32} width={32} symbol={asset.symbol} uri={asset.logoURI} />
        <View position="absolute" bottom={-4} right={-4}>
          <ChainLogo chainId={asset.chainId} size={16} borderRadius="$r_0" />
        </View>
      </View>
      <YStack gap="$s2" width={80} opacity={contentOpacity}>
        <Text subHeadline color="$uiNeutralPrimary" numberOfLines={1}>
          {asset.symbol}
        </Text>
        <Text caption color="$uiNeutralSecondary" numberOfLines={1}>
          {`$${priceUSD.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Text>
      </YStack>
      <YStack gap="$s2" flex={1} alignItems="flex-end" opacity={contentOpacity}>
        <Text sensitive emphasized subHeadline color="$uiNeutralPrimary" textAlign="right">
          {`$${asset.usdValue.toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Text>
        <Text caption color="$uiNeutralSecondary" textAlign="right">
          {`${Number(formatUnits(balance, asset.decimals)).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: Math.min(6, asset.decimals) })} ${asset.symbol}`}
        </Text>
      </YStack>
      {pending ? (
        <Spinner size="small" color="$interactiveOnBaseBrandSoft" />
      ) : disabled ? (
        <Info size={16} color="$interactiveOnBaseBrandSoft" />
      ) : (
        <ChevronRight size={16} color="$interactiveOnBaseBrandSoft" />
      )}
    </XStack>
  );
}

function NetworkSection({
  group,
  isFirst,
  disabled,
  onSelect,
  pending,
}: {
  disabled: boolean;
  group: NetworkGroup;
  isFirst: boolean;
  onSelect: (asset: ExternalAsset) => void;
  pending: boolean;
}) {
  return (
    <YStack gap="$s2" marginTop={isFirst ? "$s3" : "$s2"}>
      <NetworkHeader name={group.chainName} />
      {group.assets.map((asset) => (
        <AssetRow
          key={`${asset.chainId}:${asset.address}`}
          asset={asset}
          disabled={disabled}
          pending={pending}
          onPress={() => {
            onSelect(asset);
          }}
        />
      ))}
    </YStack>
  );
}

function isUnsupported(chainId: number, deployedChains: Map<number, boolean>) {
  return chainId !== chain.id && (!alchemyChainById.has(chainId) || deployedChains.get(chainId) === false);
}

const pressStyle = { opacity: 0.7 };
