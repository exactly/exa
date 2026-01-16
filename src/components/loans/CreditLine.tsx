import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { formatUnits, zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { borrowLimit } from "@exactly/lib";

import assetLogos from "../../utils/assetLogos";
import queryClient, { type Loan } from "../../utils/queryClient";
import useAccount from "../../utils/useAccount";
import useInstallments from "../../utils/useInstallments";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import Text from "../shared/Text";

export default function CreditLine() {
  const { address } = useAccount();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
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
          {t("Available funding")}
        </Text>
      </XStack>
      <YStack padding="$s4" paddingTop={0}>
        <XStack alignItems="center" gap="$s2">
          <AssetLogo source={{ uri: assetLogos.USDC }} width={20} height={20} />
          <Text emphasized title2 sensitive>
            {(markets ? Number(formatUnits(borrowLimit(markets, marketUSDCAddress), 6)) : 0).toLocaleString(language, {
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
                {t("Next due date:")}{" "}
              </Text>
              <Text primary footnote>
                {new Date(firstMaturity * 1000).toLocaleDateString(language, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </Text>
            </XStack>
            <XStack alignItems="center" flexWrap="wrap">
              <Text secondary footnote>
                {t("Installments due:")}{" "}
              </Text>
              <Text primary footnote>
                {t("Every 28 days")}
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
              router.push("/loan/amount");
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
            {t("Explore funding options")}
          </Button>
        </YStack>
      </YStack>
    </YStack>
  );
}
