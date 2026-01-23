import React from "react";
import { useTranslation } from "react-i18next";

import { Check } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import { zeroAddress } from "viem";

import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerPreviewBorrowAtMaturity } from "@exactly/common/generated/hooks";
import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";

import AssetLogo from "./AssetLogo";
import Skeleton from "./Skeleton";
import Text from "./Text";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";

import type { Hex } from "@exactly/common/validation";

export default function InstallmentSelector({
  value,
  onSelect,
  market,
  totalAmount,
}: {
  market: Hex;
  onSelect: (installments: number) => void;
  totalAmount: bigint;
  value: number;
}) {
  const { market: assetMarket, account } = useAsset(market);
  return (
    <YStack gap="$s3">
      {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((installment) => (
        <Installment
          key={installment}
          installment={installment}
          market={assetMarket}
          account={account}
          totalAmount={totalAmount}
          onSelect={onSelect}
          selected={value === installment}
        />
      ))}
    </YStack>
  );
}

function Installment({
  installment,
  market,
  account,
  totalAmount,
  onSelect,
  selected,
}: {
  account: Awaited<ReturnType<typeof useAsset>>["account"];
  installment: number;
  market: Awaited<ReturnType<typeof useAsset>>["market"];
  onSelect: (value: number) => void;
  selected: boolean;
  totalAmount: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const hasInstallments = installment > 0;
  const isBorrow = installment === 1;
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);

  const {
    data: installments,
    firstMaturity,
    isFetching: isInstallmentsPending,
  } = useInstallments({ totalAmount, installments: installment, marketAddress: market?.market });

  const { data: borrow, isLoading: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [market?.market ?? zeroAddress, BigInt(firstMaturity), totalAmount],
    query: { enabled: isBorrow && totalAmount > 0n && !!market && !!account && !!firstMaturity },
  });

  const installmentAmount = !isBorrow && installments ? (installments.installments[0] ?? 0n) : (borrow?.assets ?? 0n);
  return (
    <XStack
      key={installment}
      minHeight={72}
      backgroundColor={selected ? "$interactiveBaseBrandSoftDefault" : "$backgroundSoft"}
      borderRadius="$r4"
      gap="$s3"
      alignItems="center"
      padding="$s4"
      cursor="pointer"
      onPress={() => {
        onSelect(installment);
      }}
      flex={1}
    >
      <XStack gap="$s3_5" alignItems="center" flex={1}>
        <XStack
          backgroundColor={selected ? "$interactiveBaseBrandDefault" : "$backgroundStrong"}
          width={16}
          height={16}
          padding={4}
          borderRadius="$r_0"
          alignItems="center"
          justifyContent="center"
        >
          {selected && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
        </XStack>
        <Text headline color={hasInstallments ? "$uiNeutralSecondary" : "$uiNeutralPrimary"}>
          {hasInstallments ? t("{{count}} installments of", { count: installment }) : t("Pay Now")}
        </Text>
      </XStack>
      <XStack gap="$s2" alignItems="center" justifyContent="flex-end" flex={1}>
        <AssetLogo height={16} symbol={symbol ?? ""} width={16} />
        <XStack>
          {hasInstallments &&
            (isInstallmentsPending || isBorrowPending ? (
              <Skeleton height={18} />
            ) : (
              <Text headline numberOfLines={1} adjustsFontSizeToFit>
                {(Number(installmentAmount) / 10 ** (market?.decimals ?? 6)).toLocaleString(language, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </Text>
            ))}
        </XStack>
      </XStack>
    </XStack>
  );
}
