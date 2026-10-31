import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ChevronRight } from "@tamagui/lucide-icons-2/icons/ChevronRight";
import { Separator, XStack, YStack } from "tamagui";

import EmptyMessage from "./EmptyMessage";
import PaymentRow from "./PaymentRow";
import useStatements from "../../utils/useStatements";
import Skeleton from "../shared/Skeleton";
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
        <YStack role="list" paddingHorizontal="$s4" paddingTop="$s3_5" paddingBottom="$s4" gap="$s4">
          {past ? (
            past.slice(0, 4).map((maturity, index) => (
              <React.Fragment key={maturity}>
                {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
                <PaymentRow maturity={maturity} onSelect={onSelect} />
              </React.Fragment>
            ))
          ) : (
            <>
              <Skeleton height={20} width="100%" />
              <Skeleton height={20} width="100%" />
            </>
          )}
        </YStack>
      )}
    </View>
  );
}
