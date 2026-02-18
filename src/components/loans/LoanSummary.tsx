import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { XStack, YStack } from "tamagui";

import { useBytecode } from "wagmi";

import { previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerPreviewBorrowAtMaturity } from "@exactly/common/generated/hooks";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";

import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

import type { Loan } from "../../utils/queryClient";

export default function LoanSummary({ loan }: { loan: Loan }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: previewerAddress, query: { enabled: !!address } });
  const { market, isFetching: isMarketFetching } = useAsset(loan.market);
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);
  const isBorrow = loan.installments === 1;
  const timestamp = useMemo(() => Math.floor(Date.now() / 1000), []);
  const defaultMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  const { data: installments, isFetching: isInstallmentsPending } = useInstallments({
    timestamp: loan.maturity ? Number(loan.maturity) : defaultMaturity,
    totalAmount: loan.amount ?? 0n,
    installments: loan.installments ?? 1,
    marketAddress: market?.market,
  });
  const { data: borrow, isLoading: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: loan.market && loan.amount ? [loan.market, loan.maturity ?? BigInt(defaultMaturity), loan.amount] : undefined,
    query: {
      enabled: isBorrow && !!loan.amount && !!loan.market && !!address && !!bytecode,
    },
  });
  const pending = isMarketFetching || isInstallmentsPending || isBorrowPending;
  const apr = useMemo(() => {
    const value =
      !isBorrow && installments
        ? Number(installments.effectiveRate) / 1e18
        : borrow && loan.amount && loan.amount > 0n && borrow.maturity > BigInt(timestamp)
          ? Number(
              ((borrow.assets - loan.amount) * WAD * 31_536_000n) /
                (loan.amount * (borrow.maturity - BigInt(timestamp))),
            ) / 1e18
          : null;
    return (
      value?.toLocaleString(language, {
        style: "percent",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) ?? "N/A"
    );
  }, [borrow, installments, isBorrow, language, loan.amount, timestamp]);
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
              {!isBorrow && installments
                ? (Number(installments.amounts.reduce((a, b) => a + b, 0n)) / 1e6).toLocaleString(language, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })
                : borrow?.assets == null
                  ? "N/A"
                  : (Number(borrow.assets) / 1e6).toLocaleString(language, {
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
