import React from "react";

import { XStack } from "tamagui";

import Text from "./Text";

export default function Chip({
  disabled,
  icon,
  label,
  selected,
  onPress,
}: {
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <XStack
      gap="$s2"
      alignItems="center"
      padding="$s3"
      borderWidth={1}
      borderColor={selected ? "$borderBrandSoft" : "$borderNeutralSoft"}
      backgroundColor={selected ? "$interactiveBaseBrandSoftDefault" : "transparent"}
      borderRadius="$r_0"
      opacity={disabled ? 0.5 : 1}
      cursor="pointer"
      role="button"
      aria-label={label}
      pressStyle={{ opacity: 0.7 }}
      onPress={onPress}
    >
      {icon}
      <Text footnote numberOfLines={1} color={selected ? "$interactiveOnBaseBrandSoft" : "$uiNeutralPrimary"}>
        {label}
      </Text>
    </XStack>
  );
}
