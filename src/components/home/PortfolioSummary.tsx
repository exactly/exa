import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons";
import { View, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { selectBalance } from "../../utils/isProcessing";
import Amount from "../shared/Amount";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

import type { ActivityItem } from "../../utils/queryClient";
import type { PortfolioAsset } from "../../utils/usePortfolio";

export default function PortfolioSummary({
  assets,
  averageRate,
  balanceUSD,
  totalBalanceUSD,
}: {
  assets: PortfolioAsset[];
  averageRate: bigint;
  balanceUSD: bigint;
  totalBalanceUSD: bigint;
}) {
  const router = useRouter();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const {
    t,
    i18n: { language },
  } = useTranslation();

  const { data: processingBalance } = useQuery<ActivityItem[], Error, number>({
    queryKey: ["activity"],
    enabled: country === "US",
    select: selectBalance,
  });

  const visible = assets.slice(0, 3);
  const extra = assets.length - 3;

  return (
    <YStack gap="$s5">
      <XStack justifyContent="space-between" alignItems="center" width="100%">
        <Text emphasized headline>
          {t("Portfolio")}
        </Text>
        <XStack
          alignItems="center"
          gap="$s1"
          cursor="pointer"
          hitSlop={20}
          onPress={() => {
            router.push("/portfolio");
          }}
        >
          <Text emphasized subHeadline color="$interactiveBaseBrandDefault">
            {t("Manage portfolio")}
          </Text>
          <ChevronRight size={16} color="$interactiveBaseBrandDefault" />
        </XStack>
      </XStack>
      <XStack justifyContent="space-between" alignItems="center" width="100%">
        <YStack>
          <Amount amount={Number(totalBalanceUSD) / 1e18} />
          {country === "US" && processingBalance ? (
            <XStack
              borderWidth={1}
              borderColor="$borderNeutralSoft"
              borderRadius="$r_0"
              padding="$s3"
              cursor="pointer"
              hitSlop={20}
              onPress={() => {
                router.push("/activity");
              }}
              gap="$s2"
              alignItems="center"
            >
              <Text emphasized subHeadline secondary>
                {t("Processing balance {{amount}}", {
                  amount: `$${processingBalance.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                })}
              </Text>
              <ChevronRight size={16} color="$uiNeutralSecondary" />
            </XStack>
          ) : balanceUSD > 0n ? (
            <Text emphasized subHeadline color="$interactiveBaseBrandDefault">
              {t("{{rate}} APR", {
                rate: (Number(averageRate) / 1e18).toLocaleString(language, {
                  style: "percent",
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 2,
                }),
              })}
            </Text>
          ) : null}
        </YStack>
        {visible.length > 0 && (
          <XStack alignItems="center">
            {visible.map((asset, index) => (
              <XStack
                key={asset.type === "protocol" ? asset.market : asset.address}
                marginRight={index < visible.length - 1 || extra > 0 ? -12 : 0}
                zIndex={visible.length - index}
              >
                <AssetLogo
                  symbol={asset.symbol}
                  uri={asset.type === "external" ? asset.logoURI : undefined}
                  width={32}
                  height={32}
                />
              </XStack>
            ))}
            {extra > 0 && (
              <View
                backgroundColor="$backgroundMild"
                borderRadius="$r_0"
                width={32}
                height={32}
                alignItems="center"
                justifyContent="center"
              >
                <Text emphasized footnote>
                  +{extra}
                </Text>
              </View>
            )}
          </XStack>
        )}
      </XStack>
    </YStack>
  );
}
