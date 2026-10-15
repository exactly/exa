import type { ComponentPropsWithoutRef, ComponentType, ReactNode } from "react";
import React from "react";

import { selectionAsync } from "expo-haptics";

import type { ArrowRight } from "@tamagui/lucide-icons-2";
import { XStack } from "tamagui";

import Text from "./Text";
import reportError from "../../utils/reportError";

export default function Tabs<T extends string>({
  items,
  value,
  onChange,
}: {
  items: readonly {
    badge?: ReactNode;
    Icon: ComponentType<ComponentPropsWithoutRef<typeof ArrowRight>>;
    key: T;
    label: string;
  }[];
  onChange: (key: T) => void;
  value: T;
}) {
  return (
    <XStack alignSelf="stretch" alignItems="flex-end" role="tablist">
      {items.map(({ key, label, Icon, badge }) => {
        const selected = key === value;
        const color = selected ? "$interactiveOnBaseBrandSoft" : "$uiNeutralSecondary";
        return (
          <XStack
            key={key}
            flex={1}
            gap="$s2"
            alignItems="center"
            justifyContent="center"
            paddingHorizontal="$s3"
            paddingVertical="$s3_5"
            borderBottomWidth={selected ? 2 : 1}
            borderBottomColor={selected ? "$interactiveBaseBrandDefault" : "$borderNeutralSoft"}
            cursor="pointer"
            role="tab"
            aria-selected={selected}
            onPress={() => {
              if (selected) return;
              selectionAsync().catch(reportError);
              onChange(key);
            }}
          >
            <Icon size={16} color={color} />
            <Text footnote numberOfLines={1} color={color}>
              {label}
            </Text>
            {badge}
          </XStack>
        );
      })}
    </XStack>
  );
}
