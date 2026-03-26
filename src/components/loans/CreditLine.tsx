import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { ArrowRight } from "@tamagui/lucide-icons";
import { Separator, XStack, YStack } from "tamagui";

import { formatUnits } from "viem";
import { useBytecode } from "wagmi";

import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { borrowLimit } from "@exactly/lib";

import queryClient, { type Loan } from "../../utils/queryClient";
import useAccount from "../../utils/useAccount";
import useInstallments from "../../utils/useInstallments";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function CreditLine() {
  const { address } = useAccount();
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const { data: bytecode } = useBytecode({ address, query: { enabled: !!address } });
  const { markets } = useMarkets({ enabled: !!bytecode });
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
          <AssetLogo symbol="USDC" width={20} height={20} />
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
                {useMemo(
                  () =>
                    new Date(firstMaturity * 1000).toLocaleDateString(language, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    }),
                  [firstMaturity, language],
                )}
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
            aria-label={t("Explore funding options")}
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
            primary
          >
            <Button.Text>{t("Explore funding options")}</Button.Text>
            <Button.Icon>
              <ArrowRight />
            </Button.Icon>
          </Button>
        </YStack>
      </YStack>
    </YStack>
  );
}
