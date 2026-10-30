import React from "react";

import { Separator, YStack } from "tamagui";

import PaymentRow from "./PaymentRow";
import Skeleton from "../shared/Skeleton";

export default function PaymentList({
  limit,
  onSelect,
  past,
}: {
  limit?: number;
  onSelect: (maturity: number) => void;
  past: number[] | undefined;
}) {
  if (!past) {
    return (
      <YStack gap="$s1">
        <Skeleton height={64} width="100%" radius={8} />
        <Skeleton height={64} width="100%" radius={8} />
      </YStack>
    );
  }
  return (
    <YStack role="list">
      {past.slice(0, limit).map((maturity, index) => (
        <React.Fragment key={maturity}>
          {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
          <PaymentRow maturity={maturity} onSelect={onSelect} />
        </React.Fragment>
      ))}
    </YStack>
  );
}
