import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TextInput } from "react-native";

import { Redirect, useLocalSearchParams, useRouter } from "expo-router";

import { ArrowDownUp, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, CircleHelp, CircleX } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQueries, useQuery } from "@tanstack/react-query";
import { safeParse } from "valibot";
import { formatUnits, parseUnits } from "viem";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { WAD, withdrawLimit } from "@exactly/lib";

import PaySheet from "./PaySheet";
import SwapSheet from "./SwapSheet";
import deployedOptions from "../../utils/deployedOptions";
import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions, lifiTokensOptions, tokenCorrelation } from "../../utils/lifi";
import parseAmount from "../../utils/parseAmount";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio from "../../utils/usePortfolio";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import Input from "../shared/Input";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Amount() {
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { asset: assetParameter, fromChain, toChain, toToken } = useLocalSearchParams();
  const payParse = safeParse(Address, assetParameter);
  const payOverride = payParse.success ? payParse.output : undefined;
  const payChainParameter = typeof fromChain === "string" ? Number(fromChain) : chain.id;
  const destinationChain = typeof toChain === "string" ? Number(toChain) : chain.id;

  const inputRef = useRef<null | TextInput>(null);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"token" | "usd">("usd");
  const [payOpen, setPayOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);

  const { address } = useAccount();
  const { allAssets, markets } = usePortfolio();
  const { data: chains } = useQuery(lifiChainsOptions);
  const { data: tokens, isPending: isTokensPending } = useQuery(lifiTokensOptions);
  const { data: swapSheetHidden } = useQuery<boolean>({ queryKey: ["settings", "swap-sheet"] });

  const destinationToken = useMemo(
    () =>
      typeof toToken === "string"
        ? tokens?.find(
            (token) =>
              token.chainId === (destinationChain as typeof token.chainId) &&
              token.address.toLowerCase() === toToken.toLowerCase(),
          )
        : undefined,
    [tokens, toToken, destinationChain],
  );

  const payChains = useMemo(
    () =>
      [
        ...new Set(
          allAssets.flatMap((item) => (item.type === "external" && item.chainId !== chain.id ? [item.chainId] : [])),
        ),
      ].sort((a, b) => a - b),
    [allAssets],
  );
  const deployedChains = useQueries({
    queries: payChains.map((id) => deployedOptions(address, id)),
    combine: (results) => payChains.filter((id, index) => results[index]?.data !== false),
  });
  const candidates = useMemo(
    () =>
      allAssets.filter(
        (item) => item.type === "protocol" || item.chainId === chain.id || deployedChains.includes(item.chainId),
      ),
    [allAssets, deployedChains],
  );

  const pay = useMemo(() => {
    if (payOverride) {
      return candidates.find(
        (item) =>
          (item.type === "external" ? item.address : item.market).toLowerCase() === payOverride.toLowerCase() &&
          (item.type === "external" ? item.chainId : chain.id) === payChainParameter,
      );
    }
    if (!destinationToken) return;
    const family = correlate(destinationToken.symbol);
    return candidates.find((item) => correlate(item.symbol) === family) ?? candidates[0];
  }, [candidates, payOverride, payChainParameter, destinationToken]);

  const payChain = pay?.type === "external" ? pay.chainId : chain.id;
  const paySymbol = pay?.symbol;
  const payDecimals = pay?.decimals ?? 18;
  const payPrice = pay ? (pay.type === "external" ? parseAmount(pay.priceUSD, 18) : pay.usdPrice) : 0n;
  const payUnderlying = pay && (pay.type === "external" ? pay.address : pay.asset);
  const payLogoURI = pay?.type === "external" ? pay.logoURI : undefined;
  const available = pay
    ? pay.type === "external"
      ? (pay.amount ?? 0n)
      : markets
        ? withdrawLimit(markets, pay.market)
        : 0n
    : 0n;

  const destination = destinationToken
    ? {
        address: destinationToken.address,
        decimals: destinationToken.decimals,
        logoURI: destinationToken.logoURI,
        price: parseAmount(destinationToken.priceUSD, 18),
        symbol: destinationToken.symbol,
      }
    : payUnderlying && paySymbol
      ? {
          address: payUnderlying,
          decimals: payDecimals,
          logoURI: payLogoURI,
          price: payPrice,
          symbol: paySymbol,
        }
      : undefined;

  const routed =
    !!destination &&
    !!payUnderlying &&
    (destinationChain !== payChain || destination.address.toLowerCase() !== payUnderlying.toLowerCase());

  const destinationDecimals = destination?.decimals ?? 18;
  const destinationUnit = 10n ** BigInt(destinationDecimals);
  const amount = parseUnits(input || "0", mode === "usd" ? 18 : destinationDecimals);
  const usdAmount = mode === "usd" ? amount : (amount * (destination?.price ?? 0n)) / destinationUnit;
  const destinationAmount =
    !destination || (mode === "usd" && destination.price <= 0n)
      ? 0n
      : mode === "token"
        ? amount
        : (amount * destinationUnit) / destination.price;
  const fromAmount = routed
    ? payPrice > 0n
      ? (usdAmount * 10n ** BigInt(payDecimals)) / payPrice
      : 0n
    : destinationAmount;
  const exceeds = fromAmount > available;
  const unpriced = !!destination && destination.price <= 0n && (mode === "usd" || routed);

  if (!payOverride && typeof toToken !== "string") return <Redirect href="/send-funds/asset" />;

  const networkName = chains?.find((item) => item.id === destinationChain)?.name ?? chain.name;
  const color = exceeds ? "$uiErrorSecondary" : amount > 0n ? "$uiNeutralPrimary" : "$uiNeutralPlaceholder";

  function change(text: string) {
    const next = text.replaceAll(",", ".");
    if (!/^\d*(?:\.\d*)?$/.test(next)) return;
    const fraction = next.split(".")[1];
    if (fraction && fraction.length > (mode === "usd" ? 2 : Math.min(8, destination?.decimals ?? 8))) return;
    if (next.replace(".", "").length > 12) return;
    setInput(next === "." ? "0." : next);
  }

  function proceed() {
    if (!pay || !destination) return;
    router.push({
      pathname: "/send-funds/receiver",
      params: {
        asset: pay.type === "external" ? pay.address : pay.market,
        fromChain: String(payChain),
        toChain: String(destinationChain),
        toToken: destination.address,
        amount: String(destinationAmount),
        fromAmount: String(fromAmount),
      },
    });
  }

  return (
    <SafeView fullScreen>
      <View gap="$s4_5" fullScreen padded>
        <XStack gap="$s3_5" justifyContent="space-between" alignItems="center">
          <IconButton
            icon={ArrowLeft}
            aria-label={t("Back")}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/send-funds/asset");
            }}
          />
          {destination ? (
            <Text emphasized subHeadline primary numberOfLines={1}>
              {t("Send {{symbol}} on {{network}}", { symbol: destination.symbol, network: networkName })}
            </Text>
          ) : (
            <Skeleton width={200} height={21} />
          )}
          <IconButton
            icon={CircleHelp}
            aria-label={t("Help")}
            onPress={() => {
              presentArticle("8950801").catch(reportError);
            }}
          />
        </XStack>
        <ScrollView
          flex={1}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <YStack flex={1} gap="$s6" alignItems="center" justifyContent="center">
            <XStack
              gap="$s2"
              alignItems="center"
              justifyContent="center"
              maxWidth="100%"
              hitSlop={12}
              onPress={() => {
                inputRef.current?.focus();
              }}
            >
              {mode === "usd" && (
                <Text fontSize={56} lineHeight={64} color={color}>
                  $
                </Text>
              )}
              <Input
                ref={inputRef}
                aria-label={t("Amount")}
                value={input}
                onChangeText={change}
                keyboardType="decimal-pad"
                placeholder="0"
                fontSize={56}
                height={64}
                padding={0}
                borderWidth={0}
                backgroundColor="transparent"
                textAlign="center"
                maxWidth="100%"
                color={color}
                placeholderTextColor="$uiNeutralPlaceholder"
              />
              {mode === "token" && !!destination && (
                <Text fontSize={56} lineHeight={64} color={color}>
                  {destination.symbol}
                </Text>
              )}
            </XStack>
            <XStack
              gap="$s3"
              alignItems="center"
              cursor="pointer"
              hitSlop={12}
              onPress={() => {
                setMode(mode === "usd" ? "token" : "usd");
                setInput(
                  input === ""
                    ? ""
                    : trim(
                        mode === "usd" ? destinationAmount : usdAmount,
                        mode === "usd" ? destinationDecimals : 18,
                        mode === "usd" ? Math.min(8, destinationDecimals) : 2,
                      ),
                );
              }}
            >
              <ArrowDownUp size={20} color="$uiNeutralPlaceholder" />
              <Text title3 color="$uiNeutralPlaceholder">
                {mode === "usd"
                  ? `${Number(formatUnits(destinationAmount, destinationDecimals)).toLocaleString(language, { maximumFractionDigits: 8 })} ${destination?.symbol ?? ""}`
                  : `$${Number(formatUnits(usdAmount, 18)).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </Text>
            </XStack>
          </YStack>
          <YStack gap="$s3" marginTop="$s4_5">
            <Text emphasized subHeadline primary paddingHorizontal="$s4">
              {t("Pay with")}
            </Text>
            <XStack
              gap="$s3"
              padding="$s4"
              alignItems="center"
              borderWidth={1}
              borderColor="$borderNeutralStrong"
              borderRadius="$r3"
              cursor="pointer"
              pressStyle={{ opacity: 0.7 }}
              onPress={() => {
                setPayOpen(true);
              }}
            >
              {paySymbol ? (
                <>
                  <AssetLogo uri={payLogoURI} symbol={paySymbol} width={32} height={32} chainId={payChain} network />
                  <YStack gap="$s2" flex={1}>
                    <Text callout primary>
                      {paySymbol}
                    </Text>
                    <Text footnote secondary>
                      {`$${Number(formatUnits((available * payPrice) / WAD, payDecimals)).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} `}
                      <Text footnote color="$uiNeutralPlaceholder">
                        {`(${Number(formatUnits(available, payDecimals)).toLocaleString(language, { maximumFractionDigits: 8 })})`}
                      </Text>
                    </Text>
                  </YStack>
                  <ChevronRight size={20} color="$uiNeutralSecondary" />
                </>
              ) : (
                <Skeleton width="100%" height={36} />
              )}
            </XStack>
            {exceeds && (
              <XStack
                gap="$s4"
                alignItems="center"
                backgroundColor="$interactiveBaseErrorSoftDefault"
                borderRadius="$r3"
                paddingHorizontal="$s4"
                paddingVertical="$s3_5"
              >
                <CircleX size={16} color="$uiErrorSecondary" />
                <Text caption2 color="$uiErrorSecondary" flex={1}>
                  {t("Insufficient balance. Try a different amount or another asset to pay with.")}
                </Text>
              </XStack>
            )}
            {unpriced && (
              <XStack
                gap="$s4"
                alignItems="center"
                backgroundColor="$interactiveBaseErrorSoftDefault"
                borderRadius="$r3"
                paddingHorizontal="$s4"
                paddingVertical="$s3_5"
              >
                <CircleX size={16} color="$uiErrorSecondary" />
                <Text caption2 color="$uiErrorSecondary" flex={1}>
                  {t("Price unavailable for {{symbol}}. Choose another asset to send.", {
                    symbol: destination.symbol,
                  })}
                </Text>
              </XStack>
            )}
          </YStack>
        </ScrollView>
        {!exceeds && !unpriced && (
          <Button
            primary
            disabled={
              destinationAmount <= 0n ||
              fromAmount <= 0n ||
              !pay ||
              !destination ||
              (typeof toToken === "string" && isTokensPending)
            }
            onPress={() => {
              if (routed && !swapSheetHidden) {
                setSwapOpen(true);
                return;
              }
              proceed();
            }}
          >
            <Button.Text>{destinationAmount > 0n ? t("Continue") : t("Enter amount")}</Button.Text>
            <Button.Icon>{destinationAmount > 0n ? <ArrowRight size={20} /> : <ArrowUp size={20} />}</Button.Icon>
          </Button>
        )}
      </View>
      <PaySheet
        open={payOpen}
        assets={candidates}
        onClose={() => {
          setPayOpen(false);
        }}
        onSelect={(selected, chainId) => {
          router.setParams({
            asset: selected,
            fromChain: String(chainId),
            toChain: String(destinationChain),
            ...(destination && { toToken: destination.address }),
          });
        }}
      />
      <SwapSheet
        open={swapOpen}
        onClose={() => {
          setSwapOpen(false);
        }}
        onContinue={() => {
          setSwapOpen(false);
          proceed();
        }}
        payChain={payChain}
        paySymbol={paySymbol}
        payUri={payLogoURI}
        toChain={destinationChain}
        toSymbol={destination?.symbol}
        toUri={destination?.logoURI}
      />
    </SafeView>
  );
}

function correlate(symbol: string) {
  return (tokenCorrelation as Record<string, string>)[symbol] ?? symbol;
}

function trim(value: bigint, scale: number, decimals: number) {
  const [integer = "0", fraction = ""] = formatUnits(value, scale).split(".");
  let text = `${integer}.${fraction.slice(0, decimals)}`;
  while (text.includes(".") && (text.endsWith("0") || text.endsWith("."))) text = text.slice(0, -1);
  return text;
}
