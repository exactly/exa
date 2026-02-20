import React from "react";
import { useTranslation } from "react-i18next";

import { XStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import Text from "./Text";
import { selectBalance } from "../../utils/isProcessing";

import type { ActivityItem } from "../../utils/queryClient";

export default function ProcessingBalance() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const { data: processingBalance } = useQuery<ActivityItem[], Error, number>({
    queryKey: ["activity"],
    enabled: country === "US",
    select: selectBalance,
  });
  if (country !== "US" || !processingBalance) return null;
  return (
    <XStack cursor="pointer">
      <Text emphasized subHeadline secondary>
        {t("Processing balance {{amount}}", {
          amount: `$${processingBalance.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        })}
      </Text>
    </XStack>
  );
}
