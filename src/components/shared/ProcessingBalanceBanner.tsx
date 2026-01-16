import React from "react";
import { useTranslation } from "react-i18next";

import { useQuery } from "@tanstack/react-query";

import Text from "./Text";
import View from "./View";
import isProcessing from "../../utils/isProcessing";
import { getActivity } from "../../utils/server";

export default function ProcessingBalanceBanner() {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: country } = useQuery({ queryKey: ["user", "country"] });
  const { data: processingBalance } = useQuery({
    queryKey: ["processing-balance"],
    queryFn: () => getActivity(),
    select: (activity) =>
      activity.reduce(
        (total, item) => (item.type === "panda" && isProcessing(item.timestamp) ? total + item.usdAmount : total),
        0,
      ),
    enabled: country === "US",
  });
  if (!processingBalance) return null;
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
          amount: processingBalance.toLocaleString(language, {
            style: "currency",
            currency: "USD",
            currencyDisplay: "narrowSymbol",
          }),
        })}
      </Text>
    </View>
  );
}
