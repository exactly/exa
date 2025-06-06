import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit, withdrawLimit } from "@exactly/lib";
import { Info } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";
import { View, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import { useReadPreviewerExactly } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import { getCard } from "../../utils/server";
import AssetLogo from "../shared/AssetLogo";
import ProcessingBalance from "../shared/ProcessingBalance";
import Text from "../shared/Text";

export default function CardLimits({ onInfoPress }: { onInfoPress: () => void }) {
  const { t } = useTranslation();
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
  const isCredit = card ? card.mode > 0 : false;
  const { address } = useAccount();
  const { data: markets } = useReadPreviewerExactly({ address: previewerAddress, args: [address ?? zeroAddress] });
  return (
    <YStack justifyContent="center" backgroundColor="$backgroundSoft" gap="$s4">
      <View display="flex" flexDirection="row" justifyContent="center" alignItems="center" gap="$s2">
        <Text emphasized subHeadline color="$uiNeutralSecondary" textAlign="center">
          Spending limit
        </Text>
        <Pressable hitSlop={15} onPress={onInfoPress}>
          <Info size={16} color="$uiBrandSecondary" />
        </Pressable>
      </View>
      <View
        alignSelf="center"
        justifyContent="center"
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
          textTransform="uppercase"
          color={isCredit ? "$cardCreditText" : "$cardDebitText"}
          maxFontSizeMultiplier={1}
        >
          {isCredit ? t("Pay in {{count}} installments enabled", { count: card?.mode }) : t("Pay Now enabled")}
        </Text>
      </View>
      <YStack gap="$s3" alignItems="center">
        <XStack justifyContent="center" alignItems="center" gap="$s3">
          {isCredit ? null : <AssetLogo width={32} height={32} uri={assetLogos.USDC} />}
          <Text
            sensitive
            textAlign="center"
            fontFamily="$mono"
            fontSize={40}
            overflow="hidden"
            maxFontSizeMultiplier={1}
          >
            {(markets
              ? Number(isCredit ? borrowLimit(markets, marketUSDCAddress) : withdrawLimit(markets, marketUSDCAddress)) /
                1e6
              : 0
            ).toLocaleString(undefined, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" })}
          </Text>
        </XStack>
        <ProcessingBalance />
      </YStack>
    </YStack>
  );
}
