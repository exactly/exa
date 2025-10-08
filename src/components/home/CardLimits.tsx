import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";
import { ChevronRight, Info } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { useReadPreviewerExactly } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import type { CardDetails } from "../../utils/card";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function CardLimits({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: card, isPending: isPendingCard } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const {
    data: markets,
    isPending: isPendingMarkets,
    isFetching: isFetchingMarkets,
  } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const isCredit = card ? card.mode > 0 : false;
  const limit =
    card && markets
      ? Number(isCredit ? borrowLimit(markets, marketUSDCAddress) : withdrawLimit(markets, marketUSDCAddress)) / 1e6
      : undefined;
  const loadingLimit = isPendingCard || isPendingMarkets || (limit === undefined && isFetchingMarkets);
  return (
    <YStack justifyContent="space-between" height="100%">
      <YStack justifyContent="center" gap="$s2" alignItems="flex-start">
        <XStack justifyContent="center" alignItems="center" gap="$s3">
          {isCredit || loadingLimit ? null : <AssetLogo width={24} height={24} uri={assetLogos.USDC} />}
          {loadingLimit ? (
            <Skeleton height={32} width={160} />
          ) : (
            <Text
              sensitive
              textAlign="center"
              fontFamily="$mono"
              fontSize={24}
              overflow="hidden"
              maxFontSizeMultiplier={1}
              color="white"
            >
              {(limit ?? 0).toLocaleString(undefined, {
                style: "currency",
                currency: "USD",
                currencyDisplay: "narrowSymbol",
              })}
            </Text>
          )}
        </XStack>
        <XStack justifyContent="center" alignItems="center" gap="$s2" hitSlop={15} onPress={onPress} cursor="pointer">
          <Text emphasized footnote secondary color="white">
            SPENDING LIMIT
          </Text>
          <Info size={12} color="white" />
        </XStack>
      </YStack>
      <XStack
        alignSelf="flex-start"
        alignItems="center"
        backgroundColor={isCredit ? "$cardCreditInteractive" : "$cardDebitInteractive"}
        borderRadius="$r2"
        paddingVertical="$s2"
        paddingHorizontal="$s3"
        cursor="pointer"
        gap="$s2"
        onPress={() => {
          navigation.navigate("(home)", { screen: "pay-mode" });
        }}
      >
        {isPendingCard ? (
          <Skeleton height={16} width={120} />
        ) : (
          <Text
            emphasized
            footnote
            textTransform="uppercase"
            color={isCredit ? "$cardCreditText" : "$cardDebitText"}
            maxFontSizeMultiplier={1}
          >
            {isCredit ? t("{{count}} installments", { count: card?.mode }) : t("Pay Now")}
          </Text>
        )}
        <ChevronRight size={16} color={isCredit ? "$cardCreditText" : "$cardDebitText"} />
      </XStack>
    </YStack>
  );
}
