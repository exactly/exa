import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight, Check, Shuffle } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import queryClient from "../../utils/queryClient";
import AssetLogo from "../shared/AssetLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

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
  const [hide, setHide] = useState(false);
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
            {t("Swap across networks")}
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
            {t(
              "You're paying with a different asset, on a different network. We'll find the best route across both and show the cost before you confirm.",
            )}
          </Text>
          <YStack gap="$s4_5" paddingTop="$s3_5">
            <Button
              primary
              onPress={() => {
                if (hide) queryClient.setQueryData(["settings", "swap-sheet"], true);
                onContinue();
              }}
            >
              <Button.Text>{t("Continue")}</Button.Text>
              <Button.Icon>
                <ArrowRight size={20} />
              </Button.Icon>
            </Button>
            <XStack
              gap="$s3"
              alignItems="center"
              justifyContent="center"
              cursor="pointer"
              role="checkbox"
              aria-label={t("Don't show again")}
              aria-checked={hide}
              onPress={() => {
                setHide(!hide);
              }}
            >
              <View
                width={16}
                height={16}
                borderWidth={1}
                borderColor="$uiNeutralSecondary"
                borderRadius="$r2"
                alignItems="center"
                justifyContent="center"
                backgroundColor={hide ? "$interactiveBaseBrandDefault" : "transparent"}
              >
                {hide && <Check size={12} color="$interactiveOnBaseBrandDefault" />}
              </View>
              <Text caption2 secondary>
                {t("Don't show again")}
              </Text>
            </XStack>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
