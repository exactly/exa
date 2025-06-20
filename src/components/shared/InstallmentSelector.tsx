import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { previewerAddress } from "@exactly/common/generated/chain";
import type { Hex } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import { Check } from "@tamagui/lucide-icons";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import AssetLogo from "./AssetLogo";
import Skeleton from "./Skeleton";
import { useReadPreviewerPreviewBorrowAtMaturity } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import Text from "../shared/Text";

export default function InstallmentSelector({
  value,
  onSelect,
  market,
  totalAmount,
}: {
  value: number;
  onSelect: (installments: number) => void;
  market: Hex;
  totalAmount: bigint;
}) {
  const { market: assetMarket, account } = useAsset(market);
  return (
    <YStack gap="$s4_5">
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
      <Text footnote color="$uiNeutralPlaceholder" numberOfLines={1} adjustsFontSizeToFit paddingHorizontal="$s2">
        Installments are due every 28 days.
      </Text>
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
  installment: number;
  market: Awaited<ReturnType<typeof useAsset>>["market"];
  account: Awaited<ReturnType<typeof useAsset>>["account"];
  totalAmount: bigint;
  onSelect: (value: number) => void;
  selected: boolean;
}) {
  const hasInstallments = installment > 0;
  const isBorrow = installment === 1;
  const isPayNow = installment === 0;

  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);
  const usdPrice = market?.usdPrice ?? 0n;
  const decimals = market?.decimals ?? 6;

  const {
    data: installments,
    firstMaturity,
    timestamp,
    isFetching: isInstallmentsPending,
  } = useInstallments({
    totalAmount,
    installments: installment,
    marketAddress: market?.market,
  });

  const { data: borrow, isLoading: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [market?.market ?? zeroAddress, BigInt(firstMaturity), totalAmount],
    query: { enabled: isBorrow && totalAmount > 0n && !!market && !!account && !!firstMaturity },
  });

  const installmentAmount = !isBorrow && installments ? (installments.installments[0] ?? 0n) : (borrow?.assets ?? 0n);
  const installmentAmountUsd = (installmentAmount * usdPrice) / 10n ** BigInt(decimals);

  const resolvedAmount = isPayNow
    ? totalAmount
    : installments && !isBorrow
      ? installments.installments.reduce((accumulator, current) => accumulator + current, 0n)
      : isBorrow && borrow
        ? borrow.assets
        : 0n;

  const resolvedAmountUsd = (resolvedAmount * usdPrice) / 10n ** BigInt(decimals);
  return (
    <XStack
      key={installment}
      minHeight={72}
      backgroundColor={selected ? "$interactiveBaseBrandSoftDefault" : "$backgroundSoft"}
      borderRadius="$r4"
      alignItems="center"
      padding="$s4"
      flex={1}
      gap="$s3_5"
      cursor="pointer"
      onPress={() => {
        onSelect(installment);
      }}
    >
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
      <YStack gap="$s1" flex={1}>
        <XStack gap="$s2" alignItems="center">
          <Text headline color={hasInstallments ? "$uiNeutralSecondary" : "$uiNeutralPrimary"}>
            {hasInstallments ? `${installment}x` : "Pay Now"}
          </Text>
          <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
          {hasInstallments &&
            (isInstallmentsPending || isBorrowPending ? (
              <Skeleton height={18} />
            ) : (
              <Text headline numberOfLines={1} adjustsFontSizeToFit flex={1}>
                {(Number(installmentAmountUsd) / 1e18).toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                })}
              </Text>
            ))}
        </XStack>
        {hasInstallments &&
          (isInstallmentsPending || isBorrowPending ? (
            <Skeleton height={20} />
          ) : (
            <Text footnote color="$uiNeutralSecondary">
              {`${
                (!isBorrow && installments
                  ? Number(installments.effectiveRate) / 1e18
                  : borrow
                    ? Number(
                        ((borrow.assets - totalAmount) * WAD * 31_536_000n) /
                          (totalAmount * (borrow.maturity - BigInt(timestamp))),
                      ) / 1e18
                    : null
                )?.toLocaleString(undefined, {
                  style: "percent",
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                }) ?? "N/A"
              } APR`}
            </Text>
          ))}
      </YStack>
      <XStack gap="$s3" alignItems="center">
        <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
        <Text
          title3
          color={isPayNow ? "$uiNeutralSecondary" : "$uiNeutralPrimary"}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {isInstallmentsPending || isBorrowPending ? (
            <Skeleton height={18} width="100%" />
          ) : (
            (Number(resolvedAmountUsd) / 1e18).toLocaleString(undefined, {
              style: "currency",
              currency: "USD",
            })
          )}
        </Text>
      </XStack>
    </XStack>
  );
}
