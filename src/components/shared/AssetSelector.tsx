import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { Address } from "@exactly/common/validation";
import { withdrawLimit } from "@exactly/lib";
import React, { useState } from "react";
import { Image } from "react-native";
import { vs } from "react-native-size-matters";
import { ToggleGroup, YStack } from "tamagui";
import { safeParse } from "valibot";
import { zeroAddress } from "viem";

import AssetLogo from "./AssetLogo";
import Skeleton from "./Skeleton";
import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import useAccountAssets from "../../utils/useAccountAssets";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelector({
  onSubmit,
  sortBy = "usdValue",
}: {
  onSubmit: (market: Address, isExternalAsset: boolean) => void;
  sortBy?: "usdValue" | "usdcFirst";
}) {
  const [selectedMarket, setSelectedMarket] = useState<Address | undefined>();
  const { address: account } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const { accountAssets, externalAssets, isPending } = useAccountAssets({ sortBy });

  if (accountAssets.length === 0) {
    if (isPending) {
      return (
        <YStack gap="$s2" borderWidth={1} borderRadius="$r3" borderColor="$borderNeutralSeparator" padding="$s3">
          <AssetSkeleton />
        </YStack>
      );
    }
    return (
      <Text textAlign="center" emphasized footnote color="$uiNeutralSecondary">
        No available assets.
      </Text>
    );
  }

  return (
    <YStack gap="$s2" borderWidth={1} borderRadius="$r3" borderColor="$borderNeutralSeparator">
      <ToggleGroup
        type="single"
        flexDirection="column"
        backgroundColor="transparent"
        padding="$s3"
        value={selectedMarket}
        onValueChange={(value) => {
          const { success, output } = safeParse(Address, value === "" ? selectedMarket : value);
          if (!success) return;
          setSelectedMarket(output);
          const isExternal = externalAssets.some(({ address }) => address === output);
          onSubmit(output, isExternal);
        }}
      >
        {accountAssets.map((asset) => {
          const availableBalance =
            asset.type === "external"
              ? Number(asset.amount ?? 0n) / 10 ** asset.decimals
              : Number(markets ? withdrawLimit(markets, asset.market) : 0n) / 10 ** asset.decimals;

          const usdPrice = asset.type === "external" ? Number(asset.priceUSD) / 1e18 : asset.usdValue / 1e18;
          const balance = availableBalance.toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: Math.min(
              8,
              Math.max(0, asset.decimals - Math.ceil(Math.log10(Math.max(1, usdPrice)))),
            ),
          });

          const symbol =
            asset.type === "external" ? asset.symbol : asset.symbol.slice(3) === "WETH" ? "ETH" : asset.symbol.slice(3);
          const name =
            asset.type === "external" ? asset.name : asset.assetName === "Wrapped Ether" ? "Ether" : asset.assetName;
          const logo =
            asset.type === "external" ? (
              <Image source={{ uri: asset.logoURI }} width={32} height={32} borderRadius={16} />
            ) : (
              <AssetLogo source={{ uri: assetLogos[symbol as keyof typeof assetLogos] }} width={32} height={32} />
            );

          const isSelected = selectedMarket === (asset.type === "external" ? asset.address : asset.market);
          return (
            <ToggleGroup.Item
              aria-label={`${symbol}, ${balance} available`}
              aria-describedby="tap to select"
              unstyled
              key={asset.type === "external" ? asset.address : asset.market}
              value={(asset.type === "external" ? asset.address : asset.market) as Address}
              borderWidth={0}
              backgroundColor="transparent"
              cursor="pointer"
              disablePassStyles
            >
              <View
                flexDirection="row"
                alignItems="center"
                justifyContent="space-between"
                paddingVertical={vs(10)}
                backgroundColor={isSelected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
                width="100%"
                paddingHorizontal="$s4"
                borderRadius="$r3"
              >
                <View flexDirection="row" gap={10} alignItems="center" maxWidth="50%">
                  {logo}
                  <View gap="$s2" alignItems="flex-start" flexShrink={1}>
                    <Text fontSize={15} fontWeight="bold" color="$uiNeutralPrimary" numberOfLines={1}>
                      {symbol}
                    </Text>
                    <Text fontSize={12} color="$uiNeutralSecondary" numberOfLines={1}>
                      {name}
                    </Text>
                  </View>
                </View>
                <View gap="$s2" flex={1}>
                  <View flexDirection="row" alignItems="center" justifyContent="flex-end">
                    <Text fontSize={15} fontWeight="bold" textAlign="right" color="$uiNeutralPrimary">
                      {asset.usdValue.toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        currencyDisplay: "narrowSymbol",
                      })}
                    </Text>
                  </View>
                  <Text fontSize={12} color="$uiNeutralSecondary" textAlign="right">
                    {`${balance} ${symbol}`}
                  </Text>
                </View>
              </View>
            </ToggleGroup.Item>
          );
        })}
        {isPending ? <AssetSkeleton /> : null}
      </ToggleGroup>
    </YStack>
  );
}

function AssetSkeleton() {
  return (
    <View flexDirection="row" alignItems="center" width="100%">
      <Skeleton height={50} width="100%" />
    </View>
  );
}
