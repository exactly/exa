import React from "react";
import { useTranslation } from "react-i18next";

import { Square, XStack, YStack } from "tamagui";

import { Check } from "../../generated/icons/Check";
import { X } from "../../generated/icons/X";
import AssetLogo from "../shared/AssetLogo";
import GradientScrollView from "../shared/GradientScrollView";
import IconButton from "../shared/IconButton";
import ExaSpinner from "../shared/Spinner";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Status({
  amount,
  children,
  description,
  onClose,
  title,
  usdc,
  variant,
}: {
  amount?: string;
  children?: React.ReactNode;
  description?: string;
  onClose: () => void;
  title: React.ReactNode;
  usdc?: string;
  variant: "error" | "pending" | "success";
}) {
  const { t } = useTranslation();
  return (
    <GradientScrollView variant={variant === "pending" ? "neutral" : variant}>
      <View flex={1}>
        <YStack gap="s7" paddingBottom="s9">
          <IconButton alignSelf="flex-start" icon={X} aria-label={t("Close")} onPress={onClose} />
          <XStack justifyContent="center" alignItems="center">
            <Square
              borderRadius="r4"
              size="s10"
              backgroundColor={
                variant === "success"
                  ? "interactiveBaseSuccessSoftDefault"
                  : variant === "error"
                    ? "interactiveBaseErrorSoftDefault"
                    : "backgroundStrong"
              }
            >
              {variant === "success" ? (
                <Check size={48} color="uiSuccessSecondary" strokeWidth={2} />
              ) : variant === "error" ? (
                <X size={48} color="uiErrorSecondary" strokeWidth={2} />
              ) : (
                <ExaSpinner backgroundColor="transparent" color="uiNeutralPrimary" />
              )}
            </Square>
          </XStack>
          <YStack gap="s4" alignItems="center">
            <Text headline primary textAlign="center">
              {title}
            </Text>
            {amount && (
              <Text title emphasized primary>
                {amount}
              </Text>
            )}
            {usdc && (
              <XStack gap="s2" alignItems="center">
                <AssetLogo symbol="USDC" width={16} height={16} />
                <Text footnote color="uiNeutralSecondary">
                  {usdc}
                </Text>
              </XStack>
            )}
            {description && (
              <Text subHeadline secondary textAlign="center">
                {description}
              </Text>
            )}
          </YStack>
        </YStack>
        <YStack flex={1} justifyContent="flex-end" alignItems="center" gap="s4">
          {children}
        </YStack>
      </View>
    </GradientScrollView>
  );
}
