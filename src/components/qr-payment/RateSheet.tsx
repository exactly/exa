import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Separator, XStack, YStack } from "tamagui";

import { queryOptions, useQuery } from "@tanstack/react-query";

import { X } from "../../generated/icons/X";
import { currencies } from "../../utils/currencies";
import { getQRQuotes } from "../../utils/server";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function RateSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: quotes, isPending } = useQuery({ ...quotesOptions, enabled: open });
  const countries = [
    { currency: "ARS", name: t("Argentina") },
    { currency: "BRL", name: t("Brazil") },
  ] as const;
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <YStack gap="s7" borderTopLeftRadius="r5" borderTopRightRadius="r5" backgroundColor="backgroundSoft">
        <YStack gap="s4" paddingTop="s5" paddingHorizontal="s5">
          <XStack justifyContent="space-between" alignItems="center" gap="s3">
            <Text emphasized headline flex={1}>
              {t("QR payments exchange rate")}
            </Text>
            <IconButton icon={X} aria-label={t("Close")} onPress={onClose} />
          </XStack>
          <Text subHeadline secondary>
            {t("Rates are an estimate. You'll see the current rate before you confirm the payment.")}
          </Text>
        </YStack>
        <YStack paddingHorizontal="s5">
          {countries.map(({ currency, name }, index) => {
            const rate = quotes?.[currency];
            return (
              <YStack key={currency}>
                {index > 0 && <Separator borderColor="borderNeutralSoft" />}
                <XStack justifyContent="space-between" alignItems="center" paddingVertical="s4" gap="s3">
                  <XStack alignItems="center" gap="s3">
                    <Text headline>{currencies[currency].emoji}</Text>
                    <Text subHeadline primary>
                      {name}
                    </Text>
                  </XStack>
                  {isPending ? (
                    <Skeleton width={120} height={16} />
                  ) : (
                    <Text subHeadline primary>
                      {rate && Number(rate) > 0 ? format(rate, currency, language) : "—"}
                    </Text>
                  )}
                </XStack>
              </YStack>
            );
          })}
        </YStack>
        <Pressable onPress={onClose}>
          <Text emphasized footnote color="interactiveBaseBrandDefault" alignSelf="center">
            {t("Close")}
          </Text>
        </Pressable>
      </YStack>
    </ModalSheet>
  );
}

export const quotesOptions = queryOptions({
  queryKey: ["ramp", "qr", "quotes"],
  queryFn: getQRQuotes,
  staleTime: 30_000,
});

export function format(rate: string, currency: string, language: string) {
  return `1 USDC = ${Number(rate).toLocaleString(language, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}
