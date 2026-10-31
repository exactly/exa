import React from "react";

import { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { XStack, type XStackProps } from "tamagui";

import AssetLogo from "./AssetLogo";
import ChainLogo from "./ChainLogo";
import View from "./View";
import useMarkets from "../../utils/useMarkets";

export default function Conversion({
  chainId,
  symbol,
  target,
  ...properties
}: XStackProps & { chainId?: number; symbol: string; target?: string }) {
  const { supportedAssets } = useMarkets();
  return (
    <XStack
      backgroundColor="$backgroundStrong"
      borderRadius="$r3"
      paddingVertical="$s5"
      paddingHorizontal="$s3_5"
      justifyContent="center"
      alignItems="center"
      gap="$s3_5"
      {...properties}
    >
      <View position="relative">
        <AssetLogo symbol={symbol} chainId={chainId} width={48} height={48} />
        <View position="absolute" bottom={-4} right={-4}>
          <ChainLogo chainId={chainId} size={24} borderRadius="$r_0" />
        </View>
      </View>
      <ArrowRight size={24} color="$uiNeutralSecondary" />
      <View position="relative">
        {target ? (
          <AssetLogo symbol={target} width={48} height={48} />
        ) : (
          <XStack>
            {supportedAssets.map((collateral, index) => (
              <XStack key={collateral} marginRight={index < supportedAssets.length - 1 ? -16 : 0} zIndex={index}>
                <AssetLogo symbol={collateral} width={48} height={48} />
              </XStack>
            ))}
          </XStack>
        )}
        <View position="absolute" bottom={-4} right={-4}>
          <ChainLogo size={24} borderRadius="$r_0" />
        </View>
      </View>
    </XStack>
  );
}
