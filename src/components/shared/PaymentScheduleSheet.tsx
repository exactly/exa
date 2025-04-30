import { MATURITY_INTERVAL } from "@exactly/lib";
import { X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import React from "react";
import { Platform } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";
import { useAccount } from "wagmi";

import AssetLogo from "./AssetLogo";
import assetLogos from "../../utils/assetLogos";
import type { Loan } from "../../utils/queryClient";
import useAspectRatio from "../../utils/useAspectRatio";
import useAsset from "../../utils/useAsset";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

export default function PaymentScheduleSheet({
  open,
  onClose,
  usdAmount,
}: {
  open: boolean;
  onClose: () => void;
  usdAmount: bigint;
}) {
  const aspectRatio = useAspectRatio();
  const { address } = useAccount();
  const { data: loan } = useQuery<Loan>({ queryKey: ["loan"], enabled: !!address });
  const { market } = useAsset(loan?.market);
  const symbol = market?.symbol.slice(3) === "WETH" ? "ETH" : market?.symbol.slice(3);
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
      snapPointsMode="fit"
      zIndex={100_000}
      disableDrag
      modal
      portalProps={Platform.OS === "web" ? { style: { aspectRatio, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
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
                  Unlike monthly payments, our installments are due every 4 weeks, which means payments are aligned with
                  a 28-day cycle rather than the calendar month.
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
                          <AssetLogo uri={assetLogos[symbol as keyof typeof assetLogos]} width={16} height={16} />
                          <Text title3 color="$uiNeutralPrimary">
                            {(Number(usdAmount) / 1e18).toLocaleString(undefined, {
                              style: "currency",
                              currency: "USD",
                            })}
                          </Text>
                        </XStack>
                        <Text title3>{format(new Date(Number(maturity) * 1000), "MMM d, yyyy")}</Text>
                      </XStack>
                    );
                  })}
                </YStack>
              </YStack>
              <YStack gap="$s5">
                <Button
                  onPress={onClose}
                  flexBasis={60}
                  contained
                  main
                  spaced
                  fullwidth
                  iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
                >
                  Close
                </Button>
              </YStack>
            </YStack>
          </SafeView>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
