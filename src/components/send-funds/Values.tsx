import { useQuery } from "@tanstack/react-query";
import React from "react";
import { XStack } from "tamagui";

import type { WithdrawDetails } from "./Withdraw";
import assetLogos from "../../utils/assetLogos";
import type { Withdraw } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Values({ amount, assetName, usdValue }: WithdrawDetails) {
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { externalAsset } = useAsset(withdraw?.market);
  return (
    <View alignItems="center" justifyContent="center">
      <View alignItems="center" gap="$s3_5">
        <XStack alignItems="center" gap="$s3">
          <AssetLogo
            {...(externalAsset
              ? { external: true, source: { uri: externalAsset.logoURI }, width: 32, height: 32, borderRadius: 20 }
              : { uri: assetLogos[assetName as keyof typeof assetLogos], width: 32, height: 32 })}
          />
          <Text title color="$uiNeutralPrimary">
            {amount} {assetName}
          </Text>
        </XStack>
        <Text body color="$uiNeutralSecondary">
          {Number(usdValue).toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
            currencyDisplay: "narrowSymbol",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </Text>
      </View>
    </View>
  );
}
