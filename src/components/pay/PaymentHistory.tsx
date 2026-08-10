import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import PaymentRow from "./PaymentRow";
import useMarkets from "../../utils/useMarkets";
import useStatements from "../../utils/useStatements";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaymentHistory({ onSelect }: { onSelect: (maturity: number) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { timestamp } = useMarkets();
  const maturities = useStatements();
  const now = Number(timestamp);
  const past = maturities.filter((maturity) => maturity < now);
  if (past.length === 0) return null;
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" overflow="hidden">
      <XStack padding="$s4" alignItems="center" justifyContent="space-between">
        <Text emphasized headline flex={1}>
          {t("Payment history")}
        </Text>
        <Pressable
          hitSlop={15}
          onPress={() => {
            router.push("/payment-history");
          }}
        >
          <XStack gap="$s1" alignItems="center">
            <Text color="$interactiveTextBrandDefault" emphasized footnote fontWeight="bold">
              {t("View all")}
            </Text>
            <ChevronRight size={14} color="$interactiveTextBrandDefault" strokeWidth={2.5} />
          </XStack>
        </Pressable>
      </XStack>
      <YStack role="list" paddingHorizontal="$s4" paddingBottom="$s4" gap="$s4">
        {past.slice(0, 4).map((maturity, index) => (
          <React.Fragment key={maturity}>
            {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
            <PaymentRow maturity={maturity} onSelect={onSelect} />
          </React.Fragment>
        ))}
      </YStack>
    </View>
  );
}
