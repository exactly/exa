import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";
import { Redirect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";

import { ArrowDownToLine, ArrowLeft, ArrowUpRight, CircleDollarSign, CircleHelp, Info } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { object, optional, pipe, regex, safeParse, string, transform } from "valibot";
import { formatUnits } from "viem";
import { useReadContract } from "wagmi";

import chain, { alchemyChains } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import deployedOptions from "../../utils/deployedOptions";
import formatTokenAmount from "../../utils/formatTokenAmount";
import { presentArticle } from "../../utils/intercom";
import {
  isSendable,
  isStock,
  lifiTokensOptions,
  marketOpen,
  restrictedCountries,
  statsOptions,
  stockAbi,
  swappable,
  toShares,
} from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useInsets from "../../utils/useInsets";
import usePortfolio from "../../utils/usePortfolio";
import exaConfig from "../../utils/wagmi/exa";
import Amount from "../shared/Amount";
import AssetLogo from "../shared/AssetLogo";
import IconButton from "../shared/IconButton";
import InfoSheet from "../shared/InfoSheet";
import MarketClosedBanner from "../shared/MarketClosedBanner";
import PriceChart from "../shared/PriceChart";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import UnsupportedSheet from "../shared/UnsupportedSheet";
import View from "../shared/View";
import { defaultSwap, sameToken, type Swap } from "../swaps/Swaps";

import type { Credential } from "@exactly/common/validation";
import type { Token } from "@lifi/sdk";

export default function Asset() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const router = useRouter();
  const insets = useInsets();
  const navigation = useNavigation();
  const params = safeParse(Search, useLocalSearchParams());
  const { data: tokens } = useQuery(lifiTokensOptions);
  const { markets, externalAssets, crossChainAssets, isExternal, isBalancesPending } = usePortfolio();
  const { data: country } = useQuery<string>({ queryKey: ["user", "country"] });
  const { data: advanced } = useQuery<boolean>({ queryKey: ["settings", "advanced-mode"] });
  const { address: account } = useAccount({ config: exaConfig });
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const remote = params.success && params.output.chainId !== chain.id ? params.output.chainId : undefined;
  const { data: deployed } = useQuery(deployedOptions(account, remote));
  const { data: factory } = useQuery(deployedOptions(credential?.factory, remote));
  const { data: market } = useQuery({
    ...statsOptions(params.success ? params.output.chainId : 0, params.success ? params.output.address : ""),
    enabled: params.success,
  });
  const { data: multiplier } = useReadContract({
    chainId: params.success ? params.output.chainId : undefined,
    address: params.success ? params.output.address : undefined,
    abi: stockAbi,
    functionName: "multiplier",
    query: { enabled: params.success && isStock(params.output) },
  });
  const [info, setInfo] = useState<(typeof stats)[number]>();
  const [unsupported, setUnsupported] = useState(false);
  if (!params.success) return <Redirect href="/(main)/(home)" />;
  const { chainId, address } = params.output;
  const token = tokens?.find(
    (candidate) =>
      (candidate.chainId as number) === chainId && candidate.address.toLowerCase() === address.toLowerCase(),
  );
  const held = [...externalAssets, ...crossChainAssets].find(
    (asset) => asset.chainId === chainId && asset.address.toLowerCase() === address.toLowerCase(),
  );
  const protocol =
    chainId === chain.id && (params.output.market !== undefined || (!held && !isExternal(chainId, address)))
      ? markets?.find(
          (candidate) =>
            candidate.market === (params.output.market ?? candidate.market) &&
            candidate.asset.toLowerCase() === address.toLowerCase(),
        )
      : undefined;
  const external = protocol ? undefined : held;
  if (tokens && markets && !isBalancesPending && !token && !protocol && !external) {
    return <Redirect href="/(main)/(home)" />;
  }
  const entry = token ?? external;
  const amount = (protocol?.floatingDepositAssets ?? 0n) + (external?.amount ?? 0n);
  const stock = !!token && isStock(token);
  const decimals = protocol?.decimals ?? external?.decimals ?? 18;
  const shares = toShares(amount, decimals, multiplier);
  const symbol = protocol ? (protocol.symbol.slice(3) === "WETH" ? "ETH" : protocol.symbol.slice(3)) : entry?.symbol;
  const tradable = chainId !== chain.id || swappable(markets).has(address.toLowerCase());
  function trade(side: "fromToken" | "toToken", selected: Token) {
    queryClient.setQueryData<Swap>(["swap"], (old) =>
      old && sameToken(selected, old[side]?.token) && old[side]?.external === !protocol
        ? old
        : { ...defaultSwap, [side]: { external: !protocol, token: selected } },
    );
    if (navigation.getState()?.routes.some(({ name }) => name === "swaps/index")) router.dismissTo("/swaps");
    else router.push("/swaps");
  }
  const priced =
    protocol && symbol ? { address, chainId, symbol, priceUSD: formatUnits(protocol.usdPrice, 18) } : entry;
  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft" paddingBottom={0}>
      <View padded flexDirection="row" alignItems="center" justifyContent="space-between">
        <IconButton
          icon={ArrowLeft}
          aria-label={t("Back")}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.dismissTo("/(main)/(home)");
            }
          }}
        />
        <IconButton
          icon={CircleHelp}
          aria-label={t("Help")}
          onPress={() => {
            presentArticle(stock ? "17155255" : "10985188").catch(reportError);
          }}
        />
      </View>
      <ScrollView
        flex={1}
        backgroundColor="$backgroundMild"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
      >
        <View padded gap="$s4_5" backgroundColor="$backgroundSoft" paddingBottom="$s5">
          <MarketClosedBanner open={stock && !marketOpen()} />
          {priced ? (
            <PriceChart
              key={`${chainId}:${address}`}
              token={priced}
              name={
                protocol ? (protocol.assetName === "Wrapped Ether" ? "Ether" : protocol.assetName) : (entry?.name ?? "")
              }
              symbol={symbol ?? priced.symbol}
              logo={
                <AssetLogo
                  network
                  height={40}
                  width={40}
                  chainId={chainId}
                  symbol={symbol}
                  uri={protocol ? undefined : entry?.logoURI}
                />
              }
            />
          ) : (
            <Skeleton width="100%" height={320} />
          )}
          {(chainId === chain.id || (alchemyChains.has(chainId) && factory === true)) && (
            <XStack gap="$s3">
              {[
                ...(!token || (stock && restrictedCountries.has(country ?? ""))
                  ? []
                  : [
                      {
                        key: "buy",
                        title: t("Buy"),
                        Icon: ArrowDownToLine,
                        supported: tradable,
                        onPress: () => {
                          trade("toToken", token);
                        },
                      },
                    ]),
                ...(token && (chainId === chain.id || deployed === true)
                  ? [
                      {
                        key: "sell",
                        title: t("Sell"),
                        Icon: CircleDollarSign,
                        supported: tradable,
                        onPress: () => {
                          trade("fromToken", token);
                        },
                      },
                    ]
                  : []),
                ...(chainId === chain.id || deployed === true
                  ? [
                      {
                        key: "send",
                        title: t("Send"),
                        Icon: ArrowUpRight,
                        supported: !!advanced || chainId !== chain.id || !!protocol || isSendable(address),
                        onPress: () => {
                          router.push({
                            pathname: "/send-funds/receiver",
                            params: { asset: protocol?.market ?? address, fromChain: String(chainId) },
                          });
                        },
                      },
                    ]
                  : []),
              ].map(({ key, title, Icon, supported, onPress }) => {
                const disabled = supported && key !== "buy" && amount === 0n;
                return (
                  <Button.Column
                    key={key}
                    primary={key === "buy"}
                    secondary={key !== "buy"}
                    disabled={disabled}
                    flex={1}
                    opacity={supported ? 1 : 0.5}
                    role="button"
                    aria-label={title}
                    aria-disabled={disabled}
                    onPress={
                      disabled
                        ? undefined
                        : () => {
                            selectionAsync().catch(reportError);
                            if (supported) onPress();
                            else setUnsupported(true);
                          }
                    }
                  >
                    <Button width="100%" padding="$s3_5" justifyContent="center" minHeight="auto">
                      <Button.Icon>
                        <Icon />
                      </Button.Icon>
                    </Button>
                    <Button.Label>{title}</Button.Label>
                  </Button.Column>
                );
              })}
            </XStack>
          )}
        </View>
        <View padded gap="$s5" paddingTop="$s6">
          {amount > 0n && (
            <YStack borderRadius="$r3" backgroundColor="$backgroundSoft">
              <Text headline emphasized padding="$s4">
                {t("Balance")}
              </Text>
              <XStack alignItems="center" gap="$s3" paddingHorizontal="$s4" paddingTop="$s4" paddingBottom="$s4_5">
                <AssetLogo
                  network
                  height={32}
                  width={32}
                  chainId={chainId}
                  symbol={symbol}
                  uri={protocol ? undefined : entry?.logoURI}
                />
                <YStack gap="$s2">
                  <Amount
                    amount={
                      (protocol
                        ? Number(
                            (protocol.floatingDepositAssets * protocol.usdPrice) / 10n ** BigInt(protocol.decimals),
                          ) / 1e18
                        : 0) + (external?.usdValue ?? 0)
                    }
                  />
                  <Text sensitive caption color="$uiNeutralSecondary">
                    {stock && shares !== undefined
                      ? t("{{amount}} shares", {
                          count: shares,
                          amount: shares.toLocaleString(language, { maximumFractionDigits: 4 }),
                        })
                      : `${formatTokenAmount(amount, decimals, language)} ${symbol}`}
                  </Text>
                </YStack>
              </XStack>
            </YStack>
          )}
          {market && stats.some((key) => market[key] != null) && (
            <YStack borderRadius="$r3" backgroundColor="$backgroundSoft">
              <Text headline emphasized padding="$s4">
                {t("Onchain stats")}
              </Text>
              <XStack flexWrap="wrap" rowGap="$s6" paddingHorizontal="$s4" paddingTop="$s4" paddingBottom="$s4_5">
                {stats.map((key) => {
                  const value = market[key];
                  if (value == null) return null;
                  const [divisor, suffix] = magnitudes.find(
                    ([threshold]) => Math.round((value / threshold) * 1e4) >= 1e4,
                  ) ?? [1, ""];
                  return (
                    <YStack key={key} width="50%" gap="$s3" paddingRight="$s3">
                      <Text title2>
                        {`$${(value / divisor).toLocaleString(language, { maximumFractionDigits: 1 })}`}
                        <Text title2 color="$uiNeutralSecondary">
                          {suffix}
                        </Text>
                      </Text>
                      <XStack
                        alignItems="center"
                        gap="$s2"
                        cursor="pointer"
                        role="button"
                        aria-label={t(labels[key])}
                        onPress={() => {
                          setInfo(key);
                        }}
                      >
                        <Text caption color="$uiNeutralSecondary" numberOfLines={1} flexShrink={1}>
                          {t(labels[key])}
                        </Text>
                        <Info size={12} color="$interactiveOnBaseBrandSoft" y={1} />
                      </XStack>
                    </YStack>
                  );
                })}
              </XStack>
            </YStack>
          )}
        </View>
      </ScrollView>
      <InfoSheet
        open={info !== undefined}
        title={info ? t(titles[info]) : ""}
        onClose={() => {
          setInfo(undefined);
        }}
      >
        {info && (
          <Text subHeadline color="$uiNeutralSecondary">
            {t(descriptions[info])}
          </Text>
        )}
      </InfoSheet>
      <UnsupportedSheet
        reason="token"
        open={unsupported}
        asset={external}
        chainName={chain.name}
        onClose={() => {
          setUnsupported(false);
        }}
      />
    </SafeView>
  );
}

const stats = ["marketCapUSD", "volumeUSD24H", "fdvUSD"] as const;

const magnitudes = [
  [1e12, "t"],
  [1e9, "b"],
  [1e6, "m"],
  [1e3, "k"],
] as const;

const labels = { marketCapUSD: "Market cap", volumeUSD24H: "1 day volume", fdvUSD: "FDV" } as const;

const titles = {
  marketCapUSD: "Market capitalization",
  volumeUSD24H: "1 day volume",
  fdvUSD: "Fully diluted value",
} as const;

const descriptions = {
  marketCapUSD: "Total value of the tokens in circulation at the current price.",
  volumeUSD24H: "Total value of this token traded in the last 24 hours.",
  fdvUSD: "Value of the maximum token supply at the current price.",
} as const;

const Search = object({
  chainId: pipe(string(), regex(/^\d+$/), transform(Number)),
  address: Address,
  market: optional(Address),
});
