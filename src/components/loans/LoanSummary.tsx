import { previewerAddress } from "@exactly/common/generated/chain";
import { MATURITY_INTERVAL, WAD } from "@exactly/lib";
import React from "react";
import { XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import { useReadPreviewerPreviewBorrowAtMaturity } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import type { Loan } from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function LoanSummary({ loan }: { loan: Loan }) {
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: previewerAddress, query: { enabled: !!address } });
  const { market } = useAsset(loan.market);
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);
  const isBorrow = loan.installments === 1;
  const timestamp = Math.floor(Date.now() / 1000);
  const defaultMaturity = timestamp - (timestamp % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  const { data: installments, isFetching: isInstallmentsPending } = useInstallments({
    timestamp: loan.maturity ? Number(loan.maturity) : defaultMaturity,
    totalAmount: loan.amount ?? 0n,
    installments: loan.installments ?? 1,
    marketAddress: market?.market,
  });
  const { data: borrow, isLoading: isBorrowPending } = useReadPreviewerPreviewBorrowAtMaturity({
    address: previewerAddress,
    args: [loan.market ?? zeroAddress, loan.maturity ?? BigInt(defaultMaturity), loan.amount ?? 0n],
    query: {
      enabled: isBorrow && !!loan.maturity && !!loan.amount && !!loan.market && !!address && !!bytecode,
    },
  });
  const pending = isInstallmentsPending || isBorrowPending;
  return (
    <YStack gap="$s1">
      <XStack justifyContent="space-between" alignItems="center">
        <Text footnote color="$uiNeutralPlaceholder">
          You repay in total
        </Text>
        {pending ? (
          <Skeleton width={100} height={24} />
        ) : (
          <XStack alignItems="center" gap="$s2">
            <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
            <Text title3>
              {(
                Number(!isBorrow && installments ? installments.amounts.reduce((a, b) => a + b, 0n) : borrow?.assets) /
                1e6
              ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
          {`${
            (!isBorrow && installments
              ? Number(installments.effectiveRate) / 1e18
              : borrow
                ? Number(
                    ((borrow.assets - (loan.amount ?? 0n)) * WAD * 31_536_000n) /
                      ((loan.amount ?? 0n) * (borrow.maturity - BigInt(timestamp))),
                  ) / 1e18
                : null
            )?.toLocaleString(undefined, {
              style: "percent",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }) ?? "N/A"
          } FIXED APR`}
        </Text>
      )}
    </YStack>
  );
}
