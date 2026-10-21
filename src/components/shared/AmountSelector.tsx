import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";

import { useLocalSearchParams } from "expo-router";

import { YStack, type TamaguiElement } from "tamagui";

import { useForm } from "@tanstack/react-form";
import { nonEmpty, parse, pipe, string } from "valibot";
import { formatUnits } from "viem";

import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";

import AmountInput from "./AmountInput";
import Button from "./StyledButton";
import Text from "./Text";
import View from "./View";
import parseAmount from "../../utils/parseAmount";
import useAsset from "../../utils/useAsset";

export default function AmountSelector({ onChange }: { onChange: (value: bigint) => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const usdInputReference = useRef<null | TamaguiElement>(null); // eslint-disable-line @eslint-react/naming-convention/ref-name
  const [overlayShown, setOverlayShown] = useState(false);

  const { asset: assetAddress } = useLocalSearchParams();
  const withdrawAsset = parse(Address, assetAddress);

  const { market, externalAsset, available } = useAsset(withdrawAsset);

  const { Field, setFieldValue } = useForm({ defaultValues: { assetInput: "", usdInput: "" } });

  const handleAssetChange = useCallback(
    (text: string) => {
      if (market) {
        setFieldValue("assetInput", text);
        const assets = parseAmount(text, market.decimals);
        setFieldValue("usdInput", assets > 0n ? formatUnits((assets * market.usdPrice) / WAD, market.decimals) : "");
        onChange(assets);
        return;
      }
      if (externalAsset) {
        setFieldValue("assetInput", text);
        const assets = parseAmount(text, externalAsset.decimals);
        const assetPriceUSD = parseAmount(externalAsset.priceUSD, 18);
        setFieldValue(
          "usdInput",
          assets > 0n ? formatUnits((assets * assetPriceUSD) / WAD, externalAsset.decimals) : "",
        );
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
          market.usdPrice > 0n ? (parseAmount(text, 18) * 10n ** BigInt(market.decimals)) / market.usdPrice : 0n;
        setFieldValue("assetInput", assets > 0n ? formatUnits(assets, market.decimals) : "");
        onChange(assets);
        return;
      }
      if (externalAsset) {
        setFieldValue("usdInput", text);
        const assetPriceUSD = parseAmount(externalAsset.priceUSD, 18);
        const assets =
          assetPriceUSD > 0n ? (parseAmount(text, 18) * 10n ** BigInt(externalAsset.decimals)) / assetPriceUSD : 0n;
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
      setFieldValue("usdInput", formatUnits((available * market.usdPrice) / WAD, market.decimals));
      onChange(available);
      return;
    }
    if (externalAsset) {
      setOverlayShown(true);
      setFieldValue("assetInput", formatUnits(available, externalAsset.decimals));
      setFieldValue(
        "usdInput",
        formatUnits((available * parseAmount(externalAsset.priceUSD, 18)) / WAD, externalAsset.decimals),
      );
      onChange(available);
    }
  }, [available, market, externalAsset, onChange, setFieldValue]);
  return (
    <YStack gap="$s3">
      <Button alignSelf="flex-end" secondary minHeight={0} padding="$s3" onPress={handleMaxAmount}>
        <Button.Text flex={0} textAlign="center">
          {t("MAX")}
        </Button.Text>
      </Button>
      <View borderRadius="$r3" gap="$s3" backgroundColor="$backgroundBrandSoft" padding="$s3">
        <Field name="assetInput" validators={{ onChange: pipe(string(), nonEmpty("empty amount")) }}>
          {({ state: { value } }) => (
            <AmountInput
              onFocus={() => {
                setOverlayShown(true);
              }}
              decimals={market?.decimals ?? externalAsset?.decimals ?? 18}
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
              <AmountInput
                ref={usdInputReference}
                decimals={18}
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
                  {`$${Number(value).toLocaleString(language, {
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
