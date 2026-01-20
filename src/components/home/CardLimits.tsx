import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight, Info } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";

import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { borrowLimit, WAD, withdrawLimit } from "@exactly/lib";

import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

import type { CardDetails } from "../../utils/server";

export default function CardLimits({ onPress }: { onPress: () => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const router = useRouter();
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  const isCredit = card ? card.mode > 0 : false;
  return (
    <YStack justifyContent="space-between" height="100%">
      <YStack justifyContent="center" gap="$s2" alignItems="flex-start">
        <XStack justifyContent="center" alignItems="center" gap="$s3">
          {isCredit ? null : <AssetLogo width={24} height={24} source={{ uri: assetLogos.USDC }} />}
          <Text
            sensitive
            textAlign="center"
            fontFamily="$mono"
            fontSize={24}
            overflow="hidden"
            maxFontSizeMultiplier={1}
            color="white"
          >
            {`$${(markets
              ? Number(
                  isCredit ? borrowLimit(markets, marketUSDCAddress) : withdrawLimit(markets, marketUSDCAddress, WAD),
                ) / 1e6
              : 0
            ).toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </Text>
        </XStack>
        <XStack justifyContent="center" alignItems="center" gap="$s2" hitSlop={15} onPress={onPress} cursor="pointer">
          <Text emphasized footnote secondary color="white" textTransform="uppercase">
            {t("Spending limit")}
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
        onPress={() => {
          router.push("/pay-mode");
        }}
      >
        <Text
          emphasized
          footnote
          textTransform="uppercase"
          color={isCredit ? "$cardCreditText" : "$cardDebitText"}
          maxFontSizeMultiplier={1}
        >
          {isCredit ? t("{{count}} installments", { count: card?.mode }) : t("Pay Now")}
        </Text>
        <ChevronRight size={16} color={isCredit ? "$cardCreditText" : "$cardDebitText"} />
      </XStack>
    </YStack>
  );
}
