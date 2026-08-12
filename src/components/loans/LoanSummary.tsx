import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { XStack, YStack } from "tamagui";

import { useBytecode } from "wagmi";

import chain, { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerPreviewBorrowAtMaturity } from "@exactly/common/generated/hooks";
import { WAD } from "@exactly/lib";

import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

import type { Address } from "@exactly/common/validation";

export default function LoanSummary({
  market,
  amount,
  installments,
  maturity,
}: {
  amount?: bigint;
  installments?: number;
  market?: Address;
  maturity?: bigint;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({
    address: previewerAddress,
    chainId: chain.id,
    query: { enabled: !!address },
  });
  const { market: asset, timestamp, isFetching: isMarketFetching } = useAsset(market);
  const symbol = asset?.symbol.slice(3) === "WETH" ? "ETH" : asset?.symbol.slice(3);
  const decimals = asset?.decimals ?? 6;
  const isBorrow = installments === 1;
  const {
    data: split,
    firstMaturity,
    isFetching: isInstallmentsPending,
  } = useInstallments({
    totalAmount: amount ?? 0n,
    installments: installments ?? 1,
    marketAddress: market,
  });
  const { data: borrow, isLoading: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    chainId: chain.id,
    args: market && amount ? [market, maturity ?? BigInt(firstMaturity), amount] : undefined,
    query: {
      enabled: isBorrow && !!amount && !!market && !!address && !!bytecode,
    },
  });
  const pending = isMarketFetching || isInstallmentsPending || isBorrowPending;
  const apr = useMemo(() => {
    const value =
      !isBorrow && split
        ? Number(split.effectiveRate) / 1e18
        : borrow && amount && amount > 0n && borrow.maturity > timestamp
          ? Number(((borrow.assets - amount) * WAD * 31_536_000n) / (amount * (borrow.maturity - timestamp))) / 1e18
          : null;
    return (
      value?.toLocaleString(language, {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) ?? "N/A"
    );
  }, [amount, borrow, isBorrow, language, split, timestamp]);
  return (
    <YStack gap="$s1">
      <XStack justifyContent="space-between" alignItems="center">
        <Text footnote color="$uiNeutralPlaceholder">
          {t("You repay in total")}
        </Text>
        {pending ? (
          <Skeleton width={100} height={24} />
        ) : (
          <XStack alignItems="center" gap="$s2">
            <AssetLogo height={16} symbol={symbol} width={16} />
            <Text title3>
              {!isBorrow && split
                ? (Number(split.installments.reduce((a, b) => a + b, 0n)) / 10 ** decimals).toLocaleString(language, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : borrow?.assets == null
                  ? "N/A"
                  : (Number(borrow.assets) / 10 ** decimals).toLocaleString(language, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
            </Text>
          </XStack>
        )}
      </XStack>
      {pending ? (
        <XStack alignSelf="flex-end">
          <Skeleton width={80} height={16} />
        </XStack>
      ) : (
        <Text secondary caption alignSelf="flex-end">
          {t("{{rate}} FIXED APR", { rate: apr })}
        </Text>
      )}
    </YStack>
  );
}
