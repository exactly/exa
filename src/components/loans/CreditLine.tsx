import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowRight, Check } from "@tamagui/lucide-icons-2";
import { Separator, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";
import { useBytecode } from "wagmi";

import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { borrowLimit } from "@exactly/lib";

import useAccount from "../../utils/useAccount";
import useLoanMarkets from "../../utils/useLoanMarkets";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

import type { Address } from "viem";

export default function CreditLine() {
  const { address } = useAccount();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: bytecode } = useBytecode({ address, chainId: chain.id, query: { enabled: !!address } });
  const { markets, firstMaturity } = useMarkets({ enabled: !!bytecode });
  const loanMarkets = useLoanMarkets();
  const [selected, setSelected] = useState<Address>(marketUSDCAddress);
  const options = useMemo(
    () =>
      loanMarkets &&
      markets
        ?.filter(({ market }) => loanMarkets.includes(market))
        .map(({ market, symbol, decimals, usdPrice }) => {
          const available = borrowLimit(markets, market);
          return {
            market,
            decimals,
            available,
            symbol: symbol.slice(3) === "WETH" ? "ETH" : symbol.slice(3),
            usdValue: (available * usdPrice) / 10n ** BigInt(decimals),
          };
        })
        .sort((a, b) => Number(b.market === marketUSDCAddress) - Number(a.market === marketUSDCAddress)),
    [markets, loanMarkets],
  );
  return (
    <YStack backgroundColor="$backgroundSoft" borderRadius="$r3">
      <XStack padding="$s4">
        <Text emphasized body primary>
          {t("Available funding")}
        </Text>
      </XStack>
      <YStack padding="$s4" paddingTop={0}>
        <YStack role="radiogroup" aria-label={t("Funding asset")} gap="$s3">
          {options ? (
            options.map(({ market, symbol, decimals, available, usdValue }) => {
              const active = market === selected;
              return (
                <XStack
                  key={market}
                  role="radio"
                  aria-checked={active}
                  aria-label={symbol}
                  cursor="pointer"
                  alignItems="center"
                  gap="$s3"
                  padding="$s3_5"
                  borderRadius="$r4"
                  backgroundColor={active ? "$interactiveBaseBrandSoftDefault" : "$backgroundMild"}
                  onPress={() => {
                    setSelected(market);
                  }}
                >
                  <XStack
                    backgroundColor={active ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
                    width={20}
                    height={20}
                    borderRadius={12}
                    alignItems="center"
                    justifyContent="center"
                  >
                    {active && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
                  </XStack>
                  <AssetLogo symbol={symbol} width={24} height={24} />
                  <Text emphasized headline primary flex={1}>
                    {symbol}
                  </Text>
                  <YStack alignItems="flex-end">
                    <Text emphasized title3 sensitive>
                      {Number(formatUnits(available, decimals)).toLocaleString(language, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Text>
                    <Text footnote secondary sensitive>
                      {`$${Number(formatUnits(usdValue, 18)).toLocaleString(language, {
                        style: "decimal",
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`}
                    </Text>
                  </YStack>
                </XStack>
              );
            })
          ) : (
            <Skeleton height={64} width="100%" />
          )}
        </YStack>
        <Separator height={1} borderColor="$borderNeutralSoft" marginVertical="$s4" />
        <YStack gap="$s5">
          <YStack gap="$s2">
            <XStack alignItems="center" flexWrap="wrap">
              <Text secondary footnote>
                {t("Next due date:")}{" "}
              </Text>
              <Text primary footnote>
                {useMemo(
                  () =>
                    new Date(firstMaturity * 1000).toLocaleDateString(language, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    }),
                  [firstMaturity, language],
                )}
              </Text>
            </XStack>
            <XStack alignItems="center" flexWrap="wrap">
              <Text secondary footnote>
                {t("Installments due:")}{" "}
              </Text>
              <Text primary footnote>
                {t("Every 28 days")}
              </Text>
            </XStack>
          </YStack>
          <Button
            aria-label={t("Explore funding options")}
            onPress={() => {
              router.push({ pathname: "/loan/amount", params: { market: selected } });
            }}
            primary
          >
            <Button.Text>{t("Explore funding options")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        </YStack>
      </YStack>
    </YStack>
  );
}
