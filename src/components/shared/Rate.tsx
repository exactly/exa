import React from "react";
import { Trans, useTranslation } from "react-i18next";
import type { GestureResponderEvent } from "react-native";

import { TrendingUp } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import Text from "./Text";

export default function Rate({
  compact = false,
  onPress,
  rate,
}: {
  compact?: boolean;
  onPress?: (event: GestureResponderEvent) => void;
  rate: bigint;
}) {
  const {
    i18n: { language },
  } = useTranslation();
  return (
    <XStack
      gap={compact ? "$s3" : "$s2"}
      alignItems="center"
      paddingHorizontal={compact ? "$s3" : "$s3_5"}
      paddingVertical="$s2"
      borderRadius="$r_0"
      backgroundColor="$interactiveBaseSuccessSoftDefault"
      cursor={onPress ? "pointer" : undefined}
      onPress={onPress}
    >
      <TrendingUp size={compact ? 16 : 20} color="$interactiveOnBaseSuccessSoft" />
      <Text caption={compact} subHeadline={!compact} color="$interactiveOnBaseSuccessSoft">
        <Trans
          i18nKey="<rate>{{rate}}</rate> APR"
          values={{
            rate: (Number(rate) / 1e18).toLocaleString(language, {
              style: "percent",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            }),
          }}
          components={{
            rate: <Text caption={compact} subHeadline={!compact} emphasized color="$interactiveOnBaseSuccessSoft" />,
          }}
        />
      </Text>
    </XStack>
  );
}
