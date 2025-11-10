import { MATURITY_INTERVAL } from "@exactly/lib";
import { X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import React from "react";
import { ScrollView, XStack, YStack } from "tamagui";

import AssetLogo from "./AssetLogo";
import ModalSheet from "./ModalSheet";
import assetLogos from "../../utils/assetLogos";
import type { Loan } from "../../utils/queryClient";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function PaymentScheduleSheet({
  open,
  onClose,
  installmentsAmount,
}: {
  open: boolean;
  onClose: () => void;
  installmentsAmount: bigint;
}) {
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const { market } = useAsset(loan?.market);
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);
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
                Payment schedule
              </Text>
              <Text subHeadline color="$uiNeutralSecondary">
                Unlike monthly payments, our installments are due every 4 weeks, which means payments are aligned with a
                28-day cycle rather than the calendar month.
              </Text>
              <YStack gap="$s5">
                {Array.from({ length: loan?.installments ?? 0 }).map((_, index) => {
                  const maturity = Number(loan?.maturity) + index * MATURITY_INTERVAL;
                  return (
                    <XStack key={index} gap="$s2" alignItems="center" justifyContent="space-between">
                      <XStack gap="$s3" alignItems="center">
                        <Text emphasized title3>
                          {index + 1}
                        </Text>
                        <AssetLogo
                          source={{ uri: assetLogos[symbol as keyof typeof assetLogos] }}
                          width={16}
                          height={16}
                        />
                        <Text title3 color="$uiNeutralPrimary">
                          {(Number(installmentsAmount) / 1e6).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </Text>
                      </XStack>
                      <Text title3>{format(new Date(maturity * 1000), "MMM d, yyyy")}</Text>
                    </XStack>
                  );
                })}
              </YStack>
            </YStack>
            <YStack gap="$s5">
              <Button onPress={onClose} primary>
                <Button.Text>Close</Button.Text>
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
