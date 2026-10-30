import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import EmptyMessage from "./EmptyMessage";
import PaymentList from "./PaymentList";
import useStatements from "../../utils/useStatements";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaymentHistory({ onSelect }: { onSelect: (maturity: number) => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const past = useStatements();
  return (
    <View
      backgroundColor="$backgroundSoft"
      borderRadius="$r3"
      shadowColor="$backgroundStrong"
      shadowOffset={{ width: 0, height: 6 }}
      shadowOpacity={0.6}
      shadowRadius={28}
    >
      <XStack padding="$s4" alignItems="center" justifyContent="space-between">
        <Text emphasized headline flex={1}>
          {t("Payment history")}
        </Text>
        {past?.length !== 0 && (
          <XStack
            gap="$s2"
            alignItems="center"
            cursor="pointer"
            role="button"
            aria-label={t("See all")}
            onPress={() => {
              router.push("/payment-history");
            }}
          >
            <Text emphasized footnote color="$interactiveBaseBrandDefault">
              {t("See all")}
            </Text>
            <ChevronRight size={16} color="$interactiveBaseBrandDefault" />
          </XStack>
        )}
      </XStack>
      {past?.length === 0 ? (
        <EmptyMessage
          emoji="📋"
          title={t("No payments made yet")}
          description={t("Once you make a payment, you’ll see it here.")}
        />
      ) : (
        <View paddingBottom="$s4">
          <PaymentList past={past} limit={4} onSelect={onSelect} />
        </View>
      )}
    </View>
  );
}
