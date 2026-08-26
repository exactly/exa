import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight, Shuffle } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import queryClient from "../../utils/queryClient";
import AssetLogo from "../shared/AssetLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function SwapSheet({
  open,
  onClose,
  onContinue,
  payChain,
  paySymbol,
  payUri,
  toChain,
  toSymbol,
  toUri,
}: {
  onClose: () => void;
  onContinue: () => void;
  open: boolean;
  payChain: number;
  paySymbol?: string;
  payUri?: string;
  toChain: number;
  toSymbol?: string;
  toUri?: string;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        paddingHorizontal="$s5"
        paddingTop="$s7"
        $platform-web={{ paddingVertical: "$s7" }}
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5">
          <Text emphasized headline primary>
            {payChain === toChain ? t("Swap assets") : t("Swap across networks")}
          </Text>
          <XStack
            backgroundColor="$backgroundStrong"
            borderRadius="$r3"
            paddingVertical="$s5"
            paddingHorizontal="$s3_5"
            gap="$s3_5"
            alignItems="center"
            justifyContent="center"
          >
            <AssetLogo uri={payUri} symbol={paySymbol} width={40} height={40} chainId={payChain} network />
            <Shuffle size={24} color="$uiNeutralPrimary" />
            <AssetLogo uri={toUri} symbol={toSymbol} width={40} height={40} chainId={toChain} network />
          </XStack>
          <Text subHeadline secondary>
            {payChain === toChain
              ? t(
                  "You're paying with a different asset. We'll find the best route and show the cost before you confirm.",
                )
              : t(
                  "You're paying with a different asset, on a different network. We'll find the best route across both and show the cost before you confirm.",
                )}
          </Text>
          <YStack paddingTop="$s3_5">
            <Button
              primary
              onPress={() => {
                queryClient.setQueryData(["settings", "swap-sheet"], true);
                onContinue();
              }}
            >
              <Button.Text>{t("Continue")}</Button.Text>
              <Button.Icon>
                <ArrowRight size={20} />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
