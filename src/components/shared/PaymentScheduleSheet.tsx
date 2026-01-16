import React from "react";
import { useTranslation } from "react-i18next";

import { X } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { MATURITY_INTERVAL } from "@exactly/lib";

import AssetLogo from "./AssetLogo";
import ModalSheet from "./ModalSheet";
import assetLogos from "../../utils/assetLogos";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

import type { Loan } from "../../utils/queryClient";

export default function PaymentScheduleSheet({
  open,
  onClose,
  installmentsAmount,
}: {
  installmentsAmount: bigint;
  onClose: () => void;
  open: boolean;
}) {
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const { market } = useAsset(loan?.market);
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);
  const {
    t,
    i18n: { language },
  } = useTranslation();
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

              {loan?.installments && loan.maturity && market ? (
                <YStack gap="$s5">
                  {Array.from({ length: loan.installments }).map((_, index) => {
                    const maturity = Number(loan.maturity) + index * MATURITY_INTERVAL;
                    return (
                      <XStack key={maturity} gap="$s2" alignItems="center" justifyContent="space-between">
                        <XStack gap="$s3" alignItems="center">
                          <Text emphasized title3>
                            {index + 1}
                          </Text>
                          <AssetLogo
                            source={{ uri: symbol ? assetLogos[symbol as keyof typeof assetLogos] : undefined }}
                            width={16}
                            height={16}
                          />
                          <Text title3 color="$uiNeutralPrimary">
                            {(Number(installmentsAmount) / 10 ** market.decimals).toLocaleString(language, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </Text>
                        </XStack>
                        <Text title3>
                          {new Date(maturity * 1000).toLocaleDateString(language, {
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
