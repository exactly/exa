import React from "react";
import { useTranslation } from "react-i18next";

import { Coins, CreditCard, FileText } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { MATURITY_INTERVAL } from "@exactly/lib";

import { group } from "../../utils/statement";
import useStatement from "../../utils/useStatement";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function Breakdown({
  maturity,
  onBack,
  onViewStatement,
}: {
  maturity: number;
  onBack: () => void;
  onViewStatement: () => void;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data, isLoading } = useStatement(maturity);
  const { cards, paid, discount, due } = group(data ?? []);

  const money = (value: number) => value.toLocaleString(language, { style: "currency", currency: "USD" });
  const day = (value: number) =>
    new Date(value * 1000).toLocaleDateString(language, { year: "numeric", month: "long", day: "numeric" });

  return (
    <YStack gap="$s5">
      <YStack gap="$s2">
        <XStack justifyContent="space-between" alignItems="center">
          <Text emphasized title3>
            {t("Summary")}
          </Text>
          <XStack gap="$s2" alignItems="center" cursor="pointer" onPress={onViewStatement}>
            <Text emphasized subHeadline color="$interactiveBaseBrandDefault">
              {t("View statement")}
            </Text>
            <FileText size={20} color="$interactiveBaseBrandDefault" />
          </XStack>
        </XStack>
        <Text footnote color="$uiNeutralSecondary">
          {t("{{start}} to {{end}}", { start: day(maturity - MATURITY_INTERVAL), end: day(maturity) })}
        </Text>
      </YStack>

      {isLoading ? (
        <YStack gap="$s3">
          <Skeleton height={44} width="100%" radius={12} />
          <Skeleton height={44} width="100%" radius={12} />
          <Skeleton height={44} width="100%" radius={12} />
        </YStack>
      ) : (
        <YStack gap="$s4">
          {cards.map((card) => (
            <XStack key={card.lastFour} gap="$s3" alignItems="center">
              <CreditCard size={16} color="$uiNeutralSecondary" />
              <Text flex={1} subHeadline color="$uiNeutralPrimary">
                {t("**** {{lastFour}} installments", { lastFour: card.lastFour })}
              </Text>
              <Text sensitive emphasized subHeadline color="$uiNeutralPrimary">
                {money(card.total)}
              </Text>
            </XStack>
          ))}
          <Separator borderColor="$borderNeutralSoft" />
          <XStack gap="$s3" alignItems="center">
            <Coins size={16} color="$uiNeutralSecondary" />
            <YStack flex={1} gap="$s1">
              <Text subHeadline color="$uiNeutralPrimary">
                {t("Payments")}
              </Text>
              {discount >= 0.01 && (
                <Text footnote color="$uiSuccessSecondary">
                  {t("{{amount}} discount", { amount: money(discount) })}
                </Text>
              )}
            </YStack>
            <Text sensitive emphasized subHeadline color="$uiNeutralPrimary">
              {money(paid === 0 ? 0 : -paid)}
            </Text>
          </XStack>
          <Separator borderColor="$borderNeutralSoft" />
          <XStack gap="$s3" alignItems="center">
            <FileText size={16} color="$uiNeutralSecondary" />
            <YStack flex={1} gap="$s1">
              <Text emphasized subHeadline color="$uiNeutralPrimary">
                {t("Total due")}
              </Text>
              <Text footnote color="$uiNeutralSecondary">
                {day(maturity)}
              </Text>
            </YStack>
            <Text sensitive emphasized title3 color="$uiNeutralPrimary">
              {money(due)}
            </Text>
          </XStack>
        </YStack>
      )}

      <Text
        emphasized
        subHeadline
        color="$interactiveTextBrandDefault"
        textAlign="center"
        cursor="pointer"
        onPress={onBack}
      >
        {t("Back")}
      </Text>
    </YStack>
  );
}
