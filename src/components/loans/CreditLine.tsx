import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit } from "@exactly/lib";
import { ArrowRight } from "@tamagui/lucide-icons";
import { format } from "date-fns";
import { router } from "expo-router";
import React from "react";
import { Separator, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import { useReadPreviewerExactly } from "../../generated/contracts";
import queryClient, { type Loan } from "../../utils/queryClient";
import useInstallments from "../../utils/useInstallments";
import Button from "../shared/Button";
import Text from "../shared/Text";

export default function CreditLine() {
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: markets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!bytecode && !!address },
  });
  const { firstMaturity } = useInstallments({ totalAmount: 100n, installments: 1 });
  return (
    <YStack backgroundColor="$backgroundSoft" borderRadius="$s3">
      <XStack padding="$s4">
        <Text emphasized body primary>
          Your credit line
        </Text>
      </XStack>
      <YStack padding="$s4" paddingTop={0}>
        <Text emphasized title2 sensitive>
          {`≈${(markets ? Number(borrowLimit(markets, marketUSDCAddress)) / 1e6 : 0).toLocaleString(undefined, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" marginVertical="$s4" />
        <YStack gap="$s5">
          <YStack gap="$s2">
            <XStack alignItems="center" flexWrap="wrap">
              <Text secondary footnote>
                Next due date:&nbsp;
              </Text>
              <Text primary footnote>
                {format(firstMaturity * 1000, "MMM d, yyyy")}
              </Text>
            </XStack>
            <XStack alignItems="center" flexWrap="wrap">
              <Text secondary footnote>
                Installments due:&nbsp;
              </Text>
              <Text primary footnote>
                Every 28 days
              </Text>
            </XStack>
          </YStack>
          <Button
            onPress={() => {
              queryClient.setQueryData<Loan>(["loan"], () => ({
                market: marketUSDCAddress,
                amount: undefined,
                installments: undefined,
                maturity: undefined,
                receiver: undefined,
              }));
              router.push("/(app)/loan/amount");
            }}
            main
            spaced
            iconAfter={<ArrowRight color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />}
            flex={0}
            contained
            height={64}
            maxFontSizeMultiplier={1.1}
            borderRadius="$r3"
          >
            Explore loan options
          </Button>
        </YStack>
      </YStack>
    </YStack>
  );
}
