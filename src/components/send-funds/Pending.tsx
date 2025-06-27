import shortenHex from "@exactly/common/shortenHex";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Square, XStack, YStack } from "tamagui";

import type { WithdrawDetails } from "./Amount";
import assetLogos from "../../utils/assetLogos";
import type { Withdraw } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import GradientScrollView from "../shared/GradientScrollView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Pending({ details: { name: assetName, amount, usdValue } }: { details: WithdrawDetails }) {
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { externalAsset } = useAsset(withdraw?.market);
  return (
    <GradientScrollView>
      <View flex={1}>
        <YStack gap="$s7" paddingBottom="$s9">
          <XStack justifyContent="center" alignItems="center">
            <Square borderRadius="$r4" backgroundColor="$backgroundStrong" size={80}>
              <ExaSpinner backgroundColor="transparent" color="$uiNeutralPrimary" />
            </Square>
          </XStack>
          <YStack gap="$s4_5" justifyContent="center" alignItems="center">
            <Text secondary body>
              Sending to&nbsp;
              <Text emphasized primary body color="$uiNeutralPrimary">
                {shortenHex(withdraw?.receiver ?? "", 5, 7)}
              </Text>
            </Text>
            <Text title primary color="$uiNeutralPrimary">
              {Number(usdValue).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
              })}
            </Text>
            <XStack gap="$s2" alignItems="center">
              <Text emphasized secondary subHeadline>
                {Number(amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}
              </Text>
              <Text emphasized secondary subHeadline>
                &nbsp;{assetName}&nbsp;
              </Text>
              <AssetLogo
                {...(externalAsset
                  ? { external: true, source: { uri: externalAsset.logoURI }, width: 16, height: 16, borderRadius: 20 }
                  : { uri: assetLogos[assetName as keyof typeof assetLogos], width: 16, height: 16 })}
              />
            </XStack>
          </YStack>
        </YStack>
      </View>
    </GradientScrollView>
  );
}
