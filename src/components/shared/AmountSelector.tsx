import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, type TextInput } from "react-native";

import { useLocalSearchParams } from "expo-router";

import { YStack } from "tamagui";

import { useForm } from "@tanstack/react-form";
import { nonEmpty, parse, pipe, string } from "valibot";
import { formatUnits, parseUnits } from "viem";

import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import Button from "./Button";
import Input from "./Input";
import Text from "./Text";
import View from "./View";
import useAsset from "../../utils/useAsset";

export default function AmountSelector({ onChange }: { onChange: (value: bigint) => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const usdInputReference = useRef<null | TextInput>(null); // eslint-disable-line @eslint-react/naming-convention/ref-name
  const [overlayShown, setOverlayShown] = useState(false);

  const { asset: assetAddress } = useLocalSearchParams();
  const withdrawAsset = parse(Address, assetAddress);

  const { market, externalAsset, available } = useAsset(withdrawAsset);

  const { Field, setFieldValue } = useForm({ defaultValues: { assetInput: "", usdInput: "" } });

  const handleAssetChange = useCallback(
    (text: string) => {
      if (market) {
        setFieldValue("assetInput", text);
        const assets = parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), market.decimals);
        const assetsUSD = Number(formatUnits((assets * market.usdPrice) / WAD, market.decimals));
        setFieldValue("usdInput", assets > 0n ? String(assetsUSD) : "");
        onChange(assets);
        return;
      }
      if (externalAsset) {
        setFieldValue("assetInput", text);
        const assets = parseUnits(text.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, ""), externalAsset.decimals);
        const assetPriceUSD = parseUnits(externalAsset.priceUSD, 18);
        const assetsUSD = Number(formatUnits((assets * assetPriceUSD) / WAD, externalAsset.decimals));
        setFieldValue("usdInput", assets > 0n ? String(assetsUSD) : "");
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
      setFieldValue("usdInput", String(assetsUSD));
      onChange(available);
      return;
    }
    if (externalAsset) {
      setOverlayShown(true);
      setFieldValue("assetInput", formatUnits(available, externalAsset.decimals));
      const assetsUSD = Number(
        formatUnits((available * parseUnits(externalAsset.priceUSD, 18)) / WAD, externalAsset.decimals),
      );
      setFieldValue("usdInput", String(assetsUSD));
      onChange(available);
    }
  }, [available, market, externalAsset, onChange, setFieldValue]);
  return (
    <YStack gap="$s3">
      <Button
        alignSelf="flex-end"
        backgroundColor="$interactiveBaseBrandSoftDefault"
        color="$interactiveOnBaseBrandSoft"
        onPress={handleMaxAmount}
      >
        {t("MAX")}
      </Button>
      <View borderRadius="$r3" gap="$s3" backgroundColor="$backgroundBrandSoft" padding="$s3">
        <Field name="assetInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
          {({ state: { value } }) => (
            <Input
              onFocus={() => {
                setOverlayShown(true);
              }}
              inputMode="decimal"
              placeholder={market?.symbol.slice(3) ?? externalAsset?.symbol ?? ""}
              onChangeText={handleAssetChange}
              value={value}
              focusStyle={{ borderColor: "$borderBrandStrong", borderWidth: 1 }}
              backgroundColor="$backgroundSoft"
              borderRadius="$r2"
              height={60}
              textAlign="center"
              fontSize={24}
              borderWidth={0}
              flex={1}
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
              <Input
                ref={usdInputReference}
                inputMode="decimal"
                onChangeText={handleUsdChange}
                placeholder={t("USD")}
                value={value}
                onBlur={() => {
                  setOverlayShown(true);
                }}
                focusStyle={{ borderColor: "$borderBrandStrong", borderWidth: 1 }}
                backgroundColor="$backgroundSoft"
                borderRadius="$r2"
                height={60}
                textAlign="center"
                fontSize={24}
                borderWidth={0}
                flex={1}
              />
              <View
                position="absolute"
                style={StyleSheet.absoluteFill}
                display={overlayShown ? "flex" : "none"}
                backgroundColor="$backgroundSoft"
                borderRadius="$r2"
                height={60}
                borderWidth={0}
                alignItems="center"
                justifyContent="center"
                flex={1}
              >
                <Text emphasized textAlign="center" fontSize={24}>
                  {`$${Number(value.replaceAll(/\D/g, ".").replaceAll(/\.(?=.*\.)/g, "")).toLocaleString(language, {
                    style: "decimal",
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 2,
                  })}`}
                </Text>
              </View>
            </View>
          )}
        </Field>
      </View>
    </YStack>
  );
}
