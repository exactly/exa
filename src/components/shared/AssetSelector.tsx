import { previewerAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { withdrawLimit } from "@exactly/lib";
import { Skeleton } from "moti/skeleton";
import React, { useState } from "react";
import { Appearance, Image } from "react-native";
import { vs } from "react-native-size-matters";
import { ToggleGroup, YStack } from "tamagui";
import { safeParse } from "valibot";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import AssetLogo from "./AssetLogo";
import { useReadPreviewerExactly } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import useAccountAssets from "../../utils/useAccountAssets";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AssetSelector({
  onSubmit,
}: {
  positions?: {
    symbol: string;
    assetName: string;
    floatingDepositAssets: bigint;
    decimals: number;
    usdValue: bigint;
    market: string;
  }[];
  onSubmit: (market: Address, isExternalAsset: boolean) => void;
}) {
  const [selectedMarket, setSelectedMarket] = useState<Address | undefined>();
  const { address: account } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });

  const { accountAssets, externalAssets, isPending: isAccountAssetsPending } = useAccountAssets();

  if (accountAssets.length === 0) {
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
        onValueChange={(value) => {
          const market = safeParse(Address, value);
          if (!market.success) return;
          setSelectedMarket(market.output);
          const isExternalAsset = externalAssets.some(({ address }) => address === market.output);
          onSubmit(market.output, isExternalAsset);
        }}
        value={selectedMarket}
      >
        {accountAssets.map((item) => {
          if (item.type === "external") {
            const { name, symbol, logoURI, address, amount, priceUSD, decimals, usdValue } = item;
            return (
              <ToggleGroup.Item unstyled key={address} value={address} borderWidth={0}>
                <View
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  paddingVertical={vs(10)}
                  backgroundColor={selectedMarket === address ? "$interactiveBaseBrandSoftDefault" : "transparent"}
                  width="100%"
                  paddingHorizontal="$s4"
                  borderRadius="$r3"
                >
                  <View flexDirection="row" gap={10} alignItems="center" maxWidth="50%">
                    <Image source={{ uri: logoURI }} width={32} height={32} style={{ borderRadius: 16 }} />
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
                        {usdValue.toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                          currencyDisplay: "narrowSymbol",
                        })}
                      </Text>
                    </View>
                    <Text fontSize={12} color="$uiNeutralSecondary" textAlign="right">
                      {`${(Number(amount ?? 0n) / 10 ** decimals).toLocaleString(undefined, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: Math.min(
                          8,
                          Math.max(0, decimals - Math.ceil(Math.log10(Math.max(1, Number(priceUSD) / 1e18)))),
                        ),
                        useGrouping: false,
                      })} ${symbol}`}
                    </Text>
                  </View>
                </View>
              </ToggleGroup.Item>
            );
          } else {
            const { symbol, assetName, decimals, usdValue, market } = item;
            return (
              <ToggleGroup.Item unstyled key={market} value={market} borderWidth={0}>
                <View
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  paddingVertical={vs(10)}
                  backgroundColor={selectedMarket === market ? "$interactiveBaseBrandSoftDefault" : "transparent"}
                  width="100%"
                  paddingHorizontal="$s4"
                  borderRadius="$r3"
                >
                  <View flexDirection="row" gap={10} alignItems="center" maxWidth="50%">
                    <AssetLogo
                      uri={
                        assetLogos[symbol.slice(3) === "WETH" ? "ETH" : (symbol.slice(3) as keyof typeof assetLogos)]
                      }
                      width={32}
                      height={32}
                    />
                    <View gap="$s2" alignItems="flex-start" flexShrink={1}>
                      <Text fontSize={15} fontWeight="bold" color="$uiNeutralPrimary" numberOfLines={1}>
                        {symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3)}
                      </Text>
                      <Text fontSize={12} color="$uiNeutralSecondary" numberOfLines={1}>
                        {assetName === "Wrapped Ether" ? "Ether" : assetName}
                      </Text>
                    </View>
                  </View>
                  <View gap="$s2" flex={1}>
                    <View flexDirection="row" alignItems="center" justifyContent="flex-end">
                      <Text fontSize={15} fontWeight="bold" textAlign="right" color="$uiNeutralPrimary">
                        {usdValue.toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                          currencyDisplay: "narrowSymbol",
                        })}
                      </Text>
                    </View>
                    <Text fontSize={12} color="$uiNeutralSecondary" textAlign="right">
                      {`${(Number(markets ? withdrawLimit(markets, market) : 0n) / 10 ** decimals).toLocaleString(
                        undefined,
                        {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: Math.min(
                            8,
                            Math.max(0, decimals - Math.ceil(Math.log10(Math.max(1, Number(usdValue) / 1e18)))),
                          ),
                          useGrouping: false,
                        },
                      )} ${symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3)}`}
                    </Text>
                  </View>
                </View>
              </ToggleGroup.Item>
            );
          }
        })}
        {isAccountAssetsPending && (
          <View flexDirection="row" alignItems="center" width="100%">
            <Skeleton height={50} width="100%" colorMode={Appearance.getColorScheme() ?? "light"} />
          </View>
        )}
      </ToggleGroup>
    </YStack>
  );
}
