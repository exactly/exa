import { WAD } from "@exactly/lib";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useRef, useState } from "react";
import type { TextInput } from "react-native";
import { StyleSheet } from "react-native";
import { ms } from "react-native-size-matters";
import { styled, YStack } from "tamagui";
import { nonEmpty, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import Button from "./Button";
import Input from "./Input";
import Text from "./Text";
import View from "./View";
import type { Withdraw } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";

export default function AmountSelector({ onChange }: { onChange: (value: bigint) => void }) {
  const usdInputReference = useRef<TextInput>(null);
  const [overlayShown, setOverlayShown] = useState(false);

  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { market, externalAsset, available } = useAsset(withdraw?.market);

  const { Field, setFieldValue } = useForm<{ assetInput: string; usdInput: string }>({
    defaultValues: { assetInput: "", usdInput: "" },
  });

  const handleAssetChange = useCallback(
    (text: string) => {
      if (market) {
        setFieldValue("assetInput", text);
        const assets = parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), market.decimals);
        const assetsUSD = Number(formatUnits((assets * market.usdPrice) / WAD, market.decimals));
        setFieldValue("usdInput", assets > 0n ? assetsUSD.toString() : "");
        onChange(assets);
        return;
      }
      if (externalAsset) {
        setFieldValue("assetInput", text);
        const assets = parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), externalAsset.decimals);
        const assetPriceUSD = parseUnits(externalAsset.priceUSD, 18);
        const assetsUSD = Number(formatUnits((assets * assetPriceUSD) / WAD, externalAsset.decimals));
        setFieldValue("usdInput", assets > 0n ? assetsUSD.toString() : "");
        onChange(assets);
      }
    },
    [market, externalAsset, setFieldValue, onChange],
  );

  const handleUsdChange = useCallback(
    (text: string) => {
      if (market) {
        setFieldValue("usdInput", text);
        const assets =
          (((parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), 18) * WAD) / market.usdPrice) *
            BigInt(10 ** market.decimals)) /
          WAD;
        setFieldValue("assetInput", assets > 0n ? formatUnits(assets, market.decimals) : "");
        onChange(assets);
        return;
      }
      if (externalAsset) {
        setFieldValue("usdInput", text);
        const assetPriceUSD = parseUnits(externalAsset.priceUSD, 18);
        const assets =
          (parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), externalAsset.decimals) * WAD) /
          assetPriceUSD;
        setFieldValue("assetInput", assets > 0n ? formatUnits(assets, externalAsset.decimals) : "");
        onChange(assets);
      }
    },
    [market, externalAsset, setFieldValue, onChange],
  );

  const handleMaxAmount = useCallback(() => {
    if (market) {
      setOverlayShown(true);
      setFieldValue("assetInput", formatUnits(available, market.decimals));
      const assetsUSD = Number(formatUnits((available * market.usdPrice) / WAD, market.decimals));
      setFieldValue("usdInput", assetsUSD.toString());
      onChange(available);
      return;
    }
    if (externalAsset) {
      setOverlayShown(true);
      setFieldValue("assetInput", formatUnits(available, externalAsset.decimals));
      const assetsUSD = Number(
        formatUnits((available * parseUnits(externalAsset.priceUSD, 18)) / WAD, externalAsset.decimals),
      );
      setFieldValue("usdInput", assetsUSD.toString());
      onChange(available);
    }
  }, [available, market, externalAsset, onChange, setFieldValue]);
  return (
    <YStack gap="$s3">
      <Button
        alignSelf="flex-end"
        backgroundColor="$interactiveBaseBrandSoftDefault"
        color="$interactiveOnBaseBrandSoft"
        padding="$s3_5"
        onPress={handleMaxAmount}
      >
        MAX
      </Button>
      <View borderRadius="$r3" gap="$s3" backgroundColor="$backgroundBrandSoft" padding="$s3">
        <Field name="assetInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
          {({ state: { value } }) => (
            <AmountInput
              onFocus={() => {
                setOverlayShown(true);
              }}
              inputMode="decimal"
              placeholder={market?.symbol.slice(3) ?? externalAsset?.symbol ?? ""}
              onChangeText={handleAssetChange}
              value={value}
            />
          )}
        </Field>
        <Field name="usdInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
          {({ state: { value } }) => (
            <View
              onPress={() => {
                setOverlayShown(false);
                usdInputReference.current?.focus();
              }}
            >
              <AmountInput
                ref={usdInputReference}
                inputMode="decimal"
                onChangeText={handleUsdChange}
                placeholder="USD"
                value={value}
                onBlur={() => {
                  setOverlayShown(true);
                }}
              />
              <View
                position="absolute"
                style={StyleSheet.absoluteFill}
                display={overlayShown ? "flex" : "none"}
                backgroundColor="$backgroundSoft"
                borderRadius="$r2"
                height={ms(60)}
                borderWidth={0}
                alignItems="center"
                justifyContent="center"
                flex={1}
              >
                <Text emphasized textAlign="center" fontSize={ms(24)}>
                  {Number(value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, "")).toLocaleString(undefined, {
                    style: "currency",
                    currency: "USD",
                    currencyDisplay: "narrowSymbol",
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}
                </Text>
              </View>
            </View>
          )}
        </Field>
      </View>
    </YStack>
  );
}

const AmountInput = styled(Input, {
  focusStyle: { borderColor: "$borderBrandStrong", borderWidth: 1 },
  backgroundColor: "$backgroundSoft",
  borderRadius: "$r2",
  height: ms(60),
  textAlign: "center",
  fontSize: ms(24),
  borderWidth: 0,
  flex: 1,
});
