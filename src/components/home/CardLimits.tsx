import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, WAD, withdrawLimit } from "@exactly/lib";
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
import { getCard } from "../../utils/server";
import useAccount from "../../utils/useAccount";
import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

export default function CardLimits({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  const { address } = useAccount();
  const navigation = useNavigation<AppNavigationProperties>();
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
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
            {(markets
              ? Number(
                  isCredit ? borrowLimit(markets, marketUSDCAddress) : withdrawLimit(markets, marketUSDCAddress, WAD),
                ) / 1e6
              : 0
            ).toLocaleString(undefined, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })}
          </Text>
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
        onPress={() => {
          navigation.navigate("(home)", { screen: "pay-mode" });
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
