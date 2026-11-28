import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { getTokens, Separator, XStack, YStack } from "tamagui";

import { queryOptions, useQuery } from "@tanstack/react-query";

import { X } from "../../generated/icons/X";
import { currencies } from "../../utils/currencies";
import reportError from "../../utils/reportError";
import { getQRQuotes } from "../../utils/server";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";

export default function RateSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const { data: quotes, isPending, isError, isFetching, refetch } = useQuery(quotesOptions);
  const countries = [
    { currency: "ARS", name: t("Argentina") },
    { currency: "BRL", name: t("Brazil") },
  ] as const;
  const unavailable = isError || (!isPending && countries.some(({ currency }) => !(Number(quotes[currency]) > 0)));
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
          {countries.map(({ currency, name }, index) => (
            <RateRow
              key={currency}
              currency={currency}
              name={name}
              rate={quotes?.[currency]}
              loading={isPending}
              separated={index > 0}
            />
          ))}
          {unavailable && (
            <XStack justifyContent="space-between" alignItems="center" gap="s3" paddingTop="s4">
              <Text caption secondary flex={1}>
                {t("We can’t get a quote right now. Try again in a moment.")}
              </Text>
              <Pressable
                disabled={isFetching}
                onPress={() => {
                  refetch().catch(reportError);
                }}
              >
                <Text emphasized footnote color="interactiveBaseBrandDefault">
                  {t("Try again")}
                </Text>
              </Pressable>
            </XStack>
          )}
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

function RateRow({
  currency,
  loading,
  name,
  rate,
  separated,
}: {
  currency: "ARS" | "BRL";
  loading: boolean;
  name: string;
  rate?: string;
  separated: boolean;
}) {
  const {
    i18n: { language },
  } = useTranslation();
  return (
    <YStack>
      {separated && <Separator borderColor="borderNeutralSoft" />}
      <XStack justifyContent="space-between" alignItems="center" paddingVertical="s4" gap="s3">
        <XStack alignItems="center" gap="s3">
          <Text headline>{currencies[currency].emoji}</Text>
          <Text subHeadline primary>
            {name}
          </Text>
        </XStack>
        {loading ? (
          <Skeleton width={getTokens().space.s12.val} height={getTokens().space.s4.val} />
        ) : (
          <Text subHeadline primary>
            {rate && Number(rate) > 0 ? format(rate, currency, language) : "—"}
          </Text>
        )}
      </XStack>
    </YStack>
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
