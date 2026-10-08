import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons-2";
import { Separator, XStack, YStack } from "tamagui";

import PaymentRow from "./PaymentRow";
import useMarkets from "../../utils/useMarkets";
import useStatements from "../../utils/useStatements";
import Button from "../shared/StyledButton";
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
        <Button
          transparent
          minHeight={0}
          paddingHorizontal={0}
          gap="$s1"
          aria-label={t("View all")}
          onPress={() => {
            router.push("/payment-history");
          }}
        >
          <Button.Text footnote fontWeight="bold">
            {t("View all")}
          </Button.Text>
          <Button.Icon>
            <ChevronRight size={14} color="$interactiveTextBrandDefault" strokeWidth={2.5} />
          </Button.Icon>
        </Button>
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
