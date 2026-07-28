import React from "react";
import { useTranslation } from "react-i18next";

import { selectionAsync } from "expo-haptics";

import { MoreHorizontal } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import useStatements from "../../utils/useStatements";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PaymentHistory({ onSelect }: { onSelect: (maturity: number) => void }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { timestamp } = useMarkets();
  const maturities = useStatements();
  const now = Number(timestamp);
  const past = maturities.filter((maturity) => maturity < now);
  if (past.length === 0) return null;
  return (
    <View backgroundColor="$backgroundSoft" borderRadius="$r3" overflow="hidden">
      <XStack padding="$s4" alignItems="center">
        <Text emphasized headline>
          {t("Payment history")}
        </Text>
      </XStack>
      <YStack role="list" paddingHorizontal="$s4" paddingBottom="$s4" gap="$s4">
        {past.map((maturity, index) => {
          const label = new Date(maturity * 1000).toLocaleDateString(language, {
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          return (
            <React.Fragment key={maturity}>
              {index > 0 && <Separator borderColor="$borderNeutralSoft" />}
              <XStack
                role="button"
                aria-label={label}
                cursor="pointer"
                alignItems="center"
                gap="$s3"
                onPress={() => {
                  selectionAsync().catch(reportError);
                  onSelect(maturity);
                }}
              >
                <Text flex={1} emphasized subHeadline color="$uiNeutralPrimary">
                  {label}
                </Text>
                <MoreHorizontal size={20} color="$interactiveBaseBrandDefault" />
              </XStack>
            </React.Fragment>
          );
        })}
      </YStack>
    </View>
  );
}
