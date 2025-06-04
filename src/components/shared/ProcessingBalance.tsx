import { useQuery } from "@tanstack/react-query";
import React from "react";
import { XStack } from "tamagui";

import Text from "./Text";
import isProcessing from "../../utils/isProcessing";
import { getActivity } from "../../utils/server";

const ProcessingBalance = () => {
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
      <Text emphasized subHeadline secondary>{`Processing balance ${processingBalance.toLocaleString(undefined, {
        style: "currency",
        currency: "USD",
        currencyDisplay: "narrowSymbol",
      })}`}</Text>
    </XStack>
  );
};

export default ProcessingBalance;
