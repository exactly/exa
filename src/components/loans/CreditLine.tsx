import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { borrowLimit } from "@exactly/lib";
import { ArrowRight } from "@tamagui/lucide-icons";
import { format } from "date-fns";
import { useNavigation } from "expo-router";
import React from "react";
import { Separator, XStack, YStack } from "tamagui";
import { formatUnits, zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import type { AppNavigationProperties } from "../../app/(main)/_layout";
import { useReadPreviewerExactly } from "../../generated/contracts";
import assetLogos from "../../utils/assetLogos";
import queryClient, { type Loan } from "../../utils/queryClient";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import Text from "../shared/Text";

export default function CreditLine() {
  const { address } = useAccount();
  const navigation = useNavigation<AppNavigationProperties>();
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
          Available funding
        </Text>
      </XStack>
      <YStack padding="$s4" paddingTop={0}>
        <XStack alignItems="center" gap="$s2">
          <AssetLogo uri={assetLogos.USDC} width={20} height={20} />
          <Text emphasized title2 sensitive>
            {(markets ? Number(formatUnits(borrowLimit(markets, marketUSDCAddress), 6)) : 0).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Text>
        </XStack>
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
              navigation.navigate("loan", { screen: "amount" });
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
            Explore funding options
          </Button>
        </YStack>
      </YStack>
    </YStack>
  );
}
