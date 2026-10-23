import React, { type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Info } from "@tamagui/lucide-icons-2";
import { Spinner, XStack, YStack } from "tamagui";

import AssetLogo from "../shared/AssetLogo";
import Text from "../shared/Text";

export default function AssetRow({
  balance,
  chainId,
  children,
  disabled = false,
  name,
  onPress,
  pending = false,
  symbol,
  uri,
  value,
}: {
  balance: string;
  chainId: number;
  children: ReactNode;
  disabled?: boolean;
  name: string;
  onPress: () => void;
  pending?: boolean;
  symbol: string;
  uri?: string;
  value: number;
}) {
  const {
    i18n: { language },
  } = useTranslation();
  const opacity = disabled ? 0.5 : 1;
  return (
    <XStack
      alignItems="center"
      gap="$s3_5"
      cursor={pending ? "default" : "pointer"}
      pressStyle={pending ? undefined : { opacity: 0.7 }}
      opacity={pending ? 0.7 : 1}
      onPress={pending ? undefined : onPress}
    >
      <YStack opacity={opacity}>
        <AssetLogo network chainId={chainId} symbol={symbol} uri={uri} width={40} height={40} />
      </YStack>
      <YStack gap="$s2" flex={1} opacity={opacity}>
        <Text callout color="$uiNeutralPrimary" numberOfLines={1}>
          {name}
        </Text>
        <Text sensitive footnote color="$uiNeutralSecondary" numberOfLines={1}>
          {balance}
        </Text>
      </YStack>
      <YStack gap="$s2" alignItems="flex-end" opacity={opacity}>
        <Text sensitive emphasized title3 color="$uiNeutralPrimary" textAlign="right">
          {`$${value.toLocaleString(language, { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
        </Text>
        {children}
      </YStack>
      {pending ? (
        <Spinner size="small" color="$interactiveOnBaseBrandSoft" />
      ) : disabled ? (
        <Info size={16} color="$interactiveOnBaseBrandSoft" />
      ) : null}
    </XStack>
  );
}
