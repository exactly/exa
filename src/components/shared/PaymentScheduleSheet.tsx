import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams } from "expo-router";

import { X } from "@tamagui/lucide-icons-2";
import { ScrollView, XStack, YStack } from "tamagui";

import { parse } from "valibot";

import { MATURITY_INTERVAL } from "@exactly/lib";

import AssetLogo from "./AssetLogo";
import ModalSheet from "./ModalSheet";
import Loan from "../../utils/Loan";
import useAsset from "../../utils/useAsset";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function PaymentScheduleSheet({
  open,
  onClose,
  installmentsAmount,
}: {
  installmentsAmount: bigint;
  onClose: () => void;
  open: boolean;
}) {
  const { market: loanMarket, installments, maturity } = parse(Loan, useLocalSearchParams());
  const { market } = useAsset(loanMarket);
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const symbol = useMemo(() => {
    if (!market) return;
    return market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3);
  }, [market]);
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s7">
            <YStack gap="$s5">
              <Text emphasized primary headline>
                {t("Payment schedule")}
              </Text>
              <Text subHeadline color="$uiNeutralSecondary">
                {t(
                  "Unlike monthly payments, our installments are due every 4 weeks, which means payments are aligned with a 28-day cycle rather than the calendar month.",
                )}
              </Text>

              {installments && maturity && market && symbol ? (
                <YStack gap="$s5">
                  {Array.from({ length: installments }).map((_, index) => {
                    const due = Number(maturity) + index * MATURITY_INTERVAL;
                    return (
                      <XStack key={due} gap="$s2" alignItems="center" justifyContent="space-between">
                        <XStack gap="$s3" alignItems="center">
                          <Text emphasized title3>
                            {index + 1}
                          </Text>
                          <AssetLogo symbol={symbol} width={16} height={16} />
                          <Text title3 color="$uiNeutralPrimary">
                            {(Number(installmentsAmount) / 10 ** market.decimals).toLocaleString(language, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </Text>
                        </XStack>
                        <Text title3>
                          {new Date(due * 1000).toLocaleDateString(language, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </Text>
                      </XStack>
                    );
                  })}
                </YStack>
              ) : null}
            </YStack>
            <YStack gap="$s5">
              <Button onPress={onClose} primary>
                <Button.Text>{t("Close")}</Button.Text>
                <Button.Icon>
                  <X />
                </Button.Icon>
              </Button>
            </YStack>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
