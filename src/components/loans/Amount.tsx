import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, ArrowRight, Check, CircleHelp, TriangleAlert } from "@tamagui/lucide-icons";
import { Checkbox, ScrollView, XStack, YStack } from "tamagui";

import { parse } from "valibot";
import { formatUnits } from "viem";
import { useBytecode } from "wagmi";

import chain from "@exactly/common/generated/chain";

import AmountSelector from "./AmountSelector";
import { presentArticle } from "../../utils/intercom";
import Loan from "../../utils/Loan";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useMarkets from "../../utils/useMarkets";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Amount() {
  const router = useRouter();
  const { address } = useAccount();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: bytecode } = useBytecode({ address, chainId: chain.id, query: { enabled: !!address } });
  const { markets } = useMarkets({ enabled: !!bytecode });
  const { market, amount: preset } = parse(Loan, useLocalSearchParams());
  const { market: asset, borrowAvailable } = useAsset(market);

  const [acknowledged, setAcknowledged] = useState(false);

  const [amount, setAmount] = useState(preset ?? 0n);

  const warning = amount > 0n && amount >= (borrowAvailable * 75n) / 100n;
  const insufficient = amount > borrowAvailable;
  const disabled = amount <= 0n || insufficient || (warning && !acknowledged);

  if (!market || (markets && !asset)) return <Redirect href="/loan" />;
  return (
    <SafeView fullScreen>
      <View
        padded
        flexDirection="row"
        gap="$s3_5"
        paddingBottom="$s4"
        justifyContent="space-between"
        alignItems="center"
      >
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }
            router.replace("/loan");
          }}
        />
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle("11541409").catch(reportError);
          }}
        />
      </View>
      <ScrollView
        backgroundColor="$backgroundMild"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <YStack padding="$s4" gap="$s4" flex={1} justifyContent="space-between">
          <YStack gap="$s4">
            <YStack gap="$s6">
              <YStack gap="$s3_5">
                <Text primary emphasized body>
                  {t("Select amount")}
                </Text>
                {markets && asset && (
                  <XStack alignItems="center" gap="$s2">
                    <Text footnote color="$uiNeutralPlaceholder">
                      {t("Available funding")}
                      {": "}
                      {Number(formatUnits(borrowAvailable, asset.decimals)).toLocaleString(language, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                    <IconButton
                      icon={CircleHelp}
                      size={16}
                      color="$uiNeutralSecondary"
                      aria-label={t("Available funding info")}
                      onPress={() => {
                        presentArticle("11550408").catch(reportError);
                      }}
                    />
                  </XStack>
                )}
              </YStack>
              <AmountSelector
                market={market}
                value={amount}
                warning={warning}
                onChange={(value) => {
                  setAmount(value);
                  setAcknowledged(false);
                }}
              />

              {insufficient && (
                <XStack gap="$s3" flex={1} alignItems="center">
                  <TriangleAlert size={16} color="$uiErrorSecondary" />
                  <Text secondary caption flex={1}>
                    {t("You’re trying to borrow more than your collateral allows. Please enter a lower amount.")}
                  </Text>
                </XStack>
              )}
            </YStack>
          </YStack>
          <YStack gap="$s4_5">
            {warning && !insufficient && (
              <XStack
                gap="$s3"
                flex={1}
                alignItems="center"
                cursor="pointer"
                onPress={() => {
                  setAcknowledged(!acknowledged);
                }}
              >
                <Checkbox
                  pointerEvents="none"
                  borderColor="$backgroundBrand"
                  backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                  checked={acknowledged}
                >
                  <Checkbox.Indicator>
                    <Check size={16} color="white" />
                  </Checkbox.Indicator>
                </Checkbox>
                <Text secondary caption flex={1}>
                  {t("I acknowledge the risks of borrowing this much against my collateral.")}
                </Text>
              </XStack>
            )}
            <Button
              onPress={() => {
                router.push({
                  pathname: "/loan/installments",
                  params: { market, amount: String(amount) },
                });
              }}
              primary={!warning || !acknowledged}
              dangerSecondary={warning && acknowledged}
              disabled={disabled}
            >
              <Button.Text>{t("Continue")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}
