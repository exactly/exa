import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";

import { ArrowDown, ArrowRight, X } from "@tamagui/lucide-icons";
import { ScrollView, Square, styled, useTheme, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";

import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import IconButton from "../shared/IconButton";
import SafeView from "../shared/SafeView";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import TransactionDetails from "../shared/TransactionDetails";
import View from "../shared/View";

import type { Token } from "@lifi/sdk";

export default function Success({
  external,
  fromUsdAmount,
  fromAmount,
  fromToken,
  toUsdAmount,
  toAmount,
  toToken,
  onClose,
}: {
  external: boolean;
  fromAmount: bigint;
  fromToken: Token;
  fromUsdAmount: number;
  onClose: () => void;
  toAmount: bigint;
  toToken: Token;
  toUsdAmount: number;
}) {
  const theme = useTheme();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <View fullScreen backgroundColor="$backgroundSoft">
      <StyledGradient
        locations={[0.5, 1]}
        position="absolute"
        top={0}
        left={0}
        right={0}
        height={220}
        opacity={0.2}
        colors={[theme.uiInfoSecondary.val, theme.backgroundSoft.val]}
      />
      <SafeView flex={1} backgroundColor="transparent">
        <ScrollView showsVerticalScrollIndicator={false} flex={1} padding="$s4">
          <YStack gap="$s7" paddingBottom="$s9">
            <IconButton
              alignSelf="flex-start"
              icon={X}
              aria-label={t("Close")}
              onPress={() => {
                invalidateSwap();
                onClose();
              }}
            />
            <XStack justifyContent="center" alignItems="center">
              <Square borderRadius="$r4" backgroundColor="$interactiveBaseInformationSoftDefault" size={80}>
                <ExaSpinner backgroundColor="transparent" color="$uiInfoSecondary" />
              </Square>
            </XStack>
            <YStack gap="$s4_5" justifyContent="center" alignItems="center">
              <Text secondary body>
                <Trans i18nKey="Swap request <em>sent</em>" components={{ em: <Text secondary body emphasized /> }} />
              </Text>
              <Text title primary color="$uiNeutralPrimary">
                {`$${fromUsdAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
              <XStack gap="$s2" alignItems="center">
                <AssetLogo symbol={fromToken.symbol} width={16} height={16} />
                <Text emphasized secondary subHeadline>
                  {Number(formatUnits(fromAmount, fromToken.decimals)).toFixed(8)}
                </Text>
              </XStack>
              <ArrowDown size={24} color="$interactiveBaseBrandDefault" />
              <Text title primary color="$uiNeutralPrimary">
                {`$${toUsdAmount.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
              <XStack gap="$s2" alignItems="center">
                <AssetLogo symbol={toToken.symbol} width={16} height={16} />
                <Text emphasized secondary subHeadline>
                  {Number(formatUnits(toAmount, toToken.decimals)).toFixed(8)}
                </Text>
              </XStack>
            </YStack>
          </YStack>
          <TransactionDetails />
        </ScrollView>
        <YStack alignItems="center" gap="$s4" padding="$s4">
          {!external && (
            <Button
              onPress={() => {
                invalidateSwap();
                router.dismissTo("/pending-proposals");
              }}
              contained
              main
              fullwidth
              spaced
              iconAfter={<ArrowRight size={16} />}
            >
              {t("View pending request")}
            </Button>
          )}
          <Pressable
            onPress={() => {
              invalidateSwap();
              onClose();
            }}
          >
            <Text emphasized footnote color="$uiBrandSecondary">
              {t("Close")}
            </Text>
          </Pressable>
        </YStack>
      </SafeView>
    </View>
  );
}

const invalidateSwap = () => void queryClient.invalidateQueries({ queryKey: ["swap"] }).catch(reportError);

const StyledGradient = styled(LinearGradient, {});
