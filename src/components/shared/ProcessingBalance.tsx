import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useTranslation } from "react-i18next";
import { XStack } from "tamagui";

import isProcessing from "../../utils/isProcessing";
import { getActivity } from "../../utils/server";
import Text from "./Text";

export default function ProcessingBalance() {
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
    <XStack cursor="pointer">
      <Text emphasized subHeadline secondary>
        {t("Processing balance {{amount}}", {
          amount: processingBalance.toLocaleString(language, {
            style: "currency",
            currency: "USD",
            currencyDisplay: "narrowSymbol",
          }),
        })}
      </Text>
    </XStack>
  );
}
