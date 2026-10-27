import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { XStack, YStack } from "tamagui";

import { useQueries, useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";

import chain, { alchemyChains, allowlists } from "@exactly/common/generated/chain";

import { ArrowRight } from "../../generated/icons/ArrowRight";
import { X } from "../../generated/icons/X";
import deployedOptions from "../../utils/deployedOptions";
import { presentArticle } from "../../utils/intercom";
import { balancesOptions, lifiChainsOptions, lifiTokensOptions, swappable, tokenCorrelation } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import useMarkets from "../../utils/useMarkets";
import usePortfolio from "../../utils/usePortfolio";
import Conversion from "../shared/Conversion";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";
import { defaultSwap, type Swap } from "../swaps/Swaps";

import type { ExternalAsset } from "../../utils/usePortfolio";
import type { Credential } from "@exactly/common/validation";

export default function ArrivalSheet({ focused }: { focused: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { address } = useAccount();
  const { externalAssets, crossChainAssets, portfolio, isBalancesPending, isExternal } = usePortfolio();
  const { markets, supportedAssets, isPending } = useMarkets();
  const { data: tokens } = useQuery(lifiTokensOptions);
  const { data: dismissed } = useQuery<string[]>({ queryKey: ["settings", "arrivals", address], enabled: !!address });
  const { fetchStatus } = useQuery(balancesOptions(address));
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const networks = [...new Set(crossChainAssets.map(({ chainId }) => chainId))].filter(
    (id) => allowlists[String(id)] && alchemyChains.get(id)?.smartAccount,
  );
  const factories = useQueries({ queries: networks.map((id) => deployedOptions(credential?.factory, id)) });
  const ready =
    !!dismissed &&
    !isPending &&
    !!markets &&
    !isBalancesPending &&
    !!tokens &&
    factories.every(({ isLoading }) => !isLoading);
  const allowed = swappable(markets);
  const collateral = (symbol: string) => supportedAssets.includes(correlate(symbol));
  const deposited = new Set(
    markets
      ?.filter(({ isFrozen, nonCollateral }) => !isFrozen && !nonCollateral)
      .flatMap(({ asset, symbol }) => [asset.toLowerCase(), ...(symbol === "exaWETH" ? [zeroAddress] : [])]),
  );
  const [arrival, setArrival] = useState<ExternalAsset>();
  const pending = [...externalAssets, ...crossChainAssets]
    .filter(
      (asset) =>
        asset.usdValue > 0 &&
        (asset.chainId === chain.id
          ? allowed.has(asset.address.toLowerCase())
          : factories[networks.indexOf(asset.chainId)]?.data === true) &&
        !(asset.chainId === chain.id && (portfolio.collateralUSD > 0n || deposited.has(asset.address.toLowerCase()))) &&
        !dismissed?.includes(`${asset.chainId}:${asset.address.toLowerCase()}`),
    )
    .sort((a, b) => b.usdValue - a.usdValue);
  if (ready && fetchStatus === "idle" && focused && pending[0] && !arrival) setArrival(pending[0]);
  const { data: chains } = useQuery({ ...lifiChainsOptions, enabled: !!arrival && arrival.chainId !== chain.id });
  if (!ready || !arrival || !focused) return null;
  const variant = arrival.chainId === chain.id ? "swap" : collateral(arrival.symbol) ? "bridge" : "bridgeSwap";
  const network =
    variant === "swap"
      ? chain.name
      : (chains?.find(({ id }) => id === arrival.chainId)?.name ?? alchemyChains.get(arrival.chainId)?.name ?? "");
  const values = { asset: arrival.symbol, chain: chain.name };
  const copy = {
    swap: {
      description: t("Swap {{asset}} to a collateral asset on {{chain}}", values),
      action: t("Swap now"),
    },
    bridge: {
      description: t("Bridge {{asset}} to {{chain}}", values),
      action: t("Bridge now"),
    },
    bridgeSwap: {
      description: t("Bridge and swap {{asset}} to a collateral asset on {{chain}}", values),
      action: t("Bridge and swap now"),
    },
  }[variant];
  const correlated = collateral(arrival.symbol) ? correlate(arrival.symbol) : undefined;
  function close() {
    queryClient.setQueryData(
      ["settings", "arrivals", address],
      [...(dismissed ?? []), ...pending.map((asset) => `${asset.chainId}:${asset.address.toLowerCase()}`)],
    );
    setArrival(undefined);
  }
  return (
    <ModalSheet open onClose={close} disableDrag>
      <SafeView paddingTop="s0" borderTopLeftRadius="r4" borderTopRightRadius="r4" backgroundColor="backgroundSoft">
        <View borderRadius="r5" borderWidth={4} borderColor="backgroundSoft" overflow="hidden">
          <Conversion
            symbol={arrival.symbol}
            chainId={arrival.chainId}
            target={correlated}
            borderRadius="r5"
            paddingVertical="s7"
          />
          <View position="absolute" top="s3" right="s3">
            <IconButton icon={X} aria-label={t("Close")} onPress={close} />
          </View>
        </View>
        <YStack gap="s5" paddingTop="s5" paddingHorizontal="s5">
          <YStack gap="s5" alignItems="center" paddingBottom="s5">
            <XStack
              alignSelf="center"
              backgroundColor="interactiveBaseSuccessDefault"
              minHeight="s4_5"
              borderRadius="r2"
              alignItems="center"
              justifyContent="center"
              paddingHorizontal="s2"
            >
              <Text
                color="interactiveOnBaseSuccessDefault"
                caption2
                emphasized
                textAlign="center"
                textTransform="uppercase"
              >
                {t("{{symbol}} on {{network}}", { symbol: arrival.symbol, network })}
              </Text>
            </XStack>
            <Text emphasized title color="interactiveTextBrandDefault" textAlign="center">
              {t("Earn yield and increase your credit limit")}
            </Text>
            <Text footnote secondary textAlign="center">
              {copy.description}
            </Text>
          </YStack>
          <YStack gap="s5">
            <Button
              primary
              onPress={() => {
                close();
                const source = tokens.find(
                  (token) =>
                    (token.chainId as number) === arrival.chainId &&
                    token.address.toLowerCase() === arrival.address.toLowerCase(),
                );
                const target = tokens.find(
                  (token) => (token.chainId as number) === chain.id && token.symbol === (correlated ?? "USDC"),
                );
                queryClient.setQueryData<Swap>(["swap"], {
                  ...defaultSwap,
                  fromToken: source && { external: isExternal(source.chainId, source.address), token: source },
                  toToken: target && { external: isExternal(target.chainId, target.address), token: target },
                });
                router.push("/swaps");
              }}
            >
              <Button.Text>{copy.action}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
            <Text
              cursor="pointer"
              onPress={() => {
                presentArticle("8950805").catch(reportError);
              }}
              emphasized
              footnote
              color="interactiveBaseBrandDefault"
              textAlign="center"
            >
              {t("Learn more")}
            </Text>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}

function correlate(symbol: string) {
  return symbol in tokenCorrelation ? tokenCorrelation[symbol as keyof typeof tokenCorrelation] : symbol;
}
