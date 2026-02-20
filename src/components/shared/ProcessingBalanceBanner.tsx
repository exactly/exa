import React from "react";
import { useTranslation } from "react-i18next";

import { useQuery } from "@tanstack/react-query";

import Text from "./Text";
import View from "./View";
import { selectBalance } from "../../utils/isProcessing";

import type { ActivityItem } from "../../utils/queryClient";

export default function ProcessingBalanceBanner() {
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
    <View
      backgroundColor="$interactiveBaseWarningSoftDefault"
      display="flex"
      flexDirection="row"
      justifyContent="space-between"
      paddingVertical="$s3"
      paddingHorizontal="$s4"
    >
      <Text emphasized footnote color="$interactiveOnBaseWarningSoft">
        {t("Processing balance → {{amount}}", {
          amount: `$${processingBalance.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        })}
      </Text>
    </View>
  );
}
