import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { X } from "@tamagui/lucide-icons-2/icons/X";
import { XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain, { alchemyChains } from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import { balancesOptions, isStock, lifiChainsOptions, lifiTokensOptions, tokenCorrelation } from "../../utils/lifi";
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

import type { CardDetails } from "../../utils/server";
import type { ExternalAsset } from "../../utils/usePortfolio";

export default function ArrivalSheet({ focused }: { focused: boolean }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { address } = useAccount();
  const { externalAssets, crossChainAssets, isBalancesPending, isExternal } = usePortfolio();
  const { supportedAssets, isPending } = useMarkets();
  const { data: tokens } = useQuery(lifiTokensOptions);
  const { data: done, isSuccess } = useQuery<boolean | null>({
    queryKey: ["settings", "arrival", address],
    enabled: !!address,
  });
  const { fetchStatus, isSuccess: isBalancesFetched } = useQuery(balancesOptions(address));
  const ready = isSuccess && !isPending && !isBalancesPending && !!tokens;
  const collateral = (symbol: string) => supportedAssets.includes(correlate(symbol));
  const [arrival, setArrival] = useState<ExternalAsset>();
  const largest = [...externalAssets, ...crossChainAssets]
    .filter(
      (asset) =>
        asset.usdValue > 0 &&
        !isStock(asset) &&
        !(asset.chainId === chain.id && supportedAssets.includes(asset.symbol)),
    )
    .sort((a, b) => b.usdValue - a.usdValue)[0];
  useEffect(() => {
    if (ready && done === null && isBalancesFetched && fetchStatus === "idle") {
      queryClient.setQueryData(["settings", "arrival", address], !!largest);
    }
  }, [ready, done, isBalancesFetched, fetchStatus, largest, address]);
  if (ready && done === false && largest && !arrival) setArrival(largest);
  const { data: chains } = useQuery({ ...lifiChainsOptions, enabled: !!arrival && arrival.chainId !== chain.id });
  const { data: card, isPending: isCardPending } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  if (!ready || done !== false || !arrival || isCardPending || !focused) return null;
  const variant = arrival.chainId === chain.id ? "swap" : collateral(arrival.symbol) ? "bridge" : "bridgeSwap";
  const network =
    variant === "swap"
      ? chain.name
      : (chains?.find(({ id }) => id === arrival.chainId)?.name ?? alchemyChains.get(arrival.chainId)?.name ?? "");
  const values = { asset: arrival.symbol, chain: chain.name };
  const copy = {
    swap: {
      description:
        card === null
          ? t("Swap {{asset}} to a collateral asset on {{chain}} to activate your Exa Card", values)
          : t("Swap {{asset}} to a collateral asset on {{chain}}", values),
      action: t("Swap now"),
    },
    bridge: {
      description:
        card === null
          ? t("Bridge {{asset}} to {{chain}} to activate your Exa Card", values)
          : t("Bridge {{asset}} to {{chain}}", values),
      action: t("Bridge now"),
    },
    bridgeSwap: {
      description:
        card === null
          ? t("Bridge and swap {{asset}} to a collateral asset on {{chain}} to activate your Exa Card", values)
          : t("Bridge and swap {{asset}} to a collateral asset on {{chain}}", values),
      action: t("Bridge and swap now"),
    },
  }[variant];
  const correlated = variant === "bridge" ? correlate(arrival.symbol) : undefined;
  function close() {
    queryClient.setQueryData(["settings", "arrival", address], true);
  }
  return (
    <ModalSheet open onClose={close} disableDrag>
      <SafeView paddingTop={0} borderTopLeftRadius="r4" borderTopRightRadius="r4" backgroundColor="backgroundSoft">
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
        <YStack gap="s5" paddingVertical="s5" paddingHorizontal="s5">
          <YStack gap="s5" alignItems="center" paddingBottom="s5">
            <XStack
              alignSelf="center"
              backgroundColor="interactiveBaseSuccessDefault"
              minHeight={20}
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
                {t("Received {{asset}} on {{network}}", { asset: arrival.symbol, network })}
              </Text>
            </XStack>
            <Text emphasized title color="interactiveTextBrandDefault" textAlign="center">
              {card === null ? t("Activate your card") : t("Earn yield and increase your credit limit")}
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
