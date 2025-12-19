import type { Token } from "@lifi/sdk";
import React from "react";
import { XStack, YStack } from "tamagui";
import { formatUnits } from "viem";

import type { RouteFrom } from "../../utils/lifi";
import Text from "../shared/Text";

export default function QuoteDetails({
  quote,
  sourceToken,
  destinationToken,
  sourceAmount,
  sourceChainName,
  destinationChainName,
}: {
  quote: RouteFrom;
  sourceToken: Token;
  destinationToken: Token;
  sourceAmount: bigint;
  sourceChainName: string;
  destinationChainName: string;
}) {
  return (
    <YStack gap="$s3_5">
      <DetailRow
        label="You send"
        value={`${Number(formatUnits(sourceAmount, sourceToken.decimals)).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: sourceToken.decimals,
          useGrouping: false,
        })} ${sourceToken.symbol}`}
      />
      <DetailRow label="Source network" value={sourceChainName} />
      <DetailRow
        label="Estimated arrival"
        value={
          quote.estimate.toAmount
            ? `≈${Number(formatUnits(BigInt(quote.estimate.toAmount), destinationToken.decimals)).toLocaleString(
                undefined,
                {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: destinationToken.decimals,
                  useGrouping: false,
                },
              )} ${destinationToken.symbol}`
            : "—"
        }
      />
      <DetailRow label="Destination network" value={destinationChainName} />
      {quote.estimate.toAmountMin && (
        <DetailRow
          label="Minimum received"
          value={`${Number(formatUnits(BigInt(quote.estimate.toAmountMin), destinationToken.decimals)).toLocaleString(
            undefined,
            {
              minimumFractionDigits: 0,
              maximumFractionDigits: destinationToken.decimals,
              useGrouping: false,
            },
          )} ${destinationToken.symbol}`}
        />
      )}
      <DetailRow label="Fees" value="0.25%" />
      <DetailRow label="Slippage" value="2%" />
      {quote.estimate.executionDuration ? (
        <DetailRow
          label="Estimated time"
          value={`~${Math.max(1, Math.round(quote.estimate.executionDuration / 60))} min`}
        />
      ) : null}
      {(quote.tool ?? quote.estimate.tool) && (
        <DetailRow label="Exchange" value={quote.tool ?? quote.estimate.tool} isUppercase />
      )}
    </YStack>
  );
}

function DetailRow({ label, value, isUppercase }: { label: string; value: string; isUppercase?: boolean }) {
  return (
    <XStack justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" gap="$s2">
      <Text caption color="$uiNeutralSecondary">
        {label}
      </Text>
      <Text
        caption
        color="$uiNeutralPrimary"
        textAlign="right"
        flexShrink={1}
        textTransform={isUppercase ? "uppercase" : "none"}
      >
        {value}
      </Text>
    </XStack>
  );
}
