import React, { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { Check } from "@tamagui/lucide-icons-2/icons/Check";
import { Search } from "@tamagui/lucide-icons-2/icons/Search";
import { ScrollView, XStack, YStack } from "tamagui";

import Input from "./Input";
import ModalSheet from "./ModalSheet";
import Text from "./Text";

export default function SelectSheet(properties: ComponentProps<typeof OptionList>) {
  return (
    <ModalSheet
      open={properties.open}
      onClose={properties.onClose}
      disableDrag
      heightPercent={properties.heightPercent}
    >
      <OptionList {...properties} />
    </ModalSheet>
  );
}

function OptionList({
  open,
  onClose,
  title,
  options,
  value,
  onChange,
  heightPercent,
  searchable,
}: {
  heightPercent?: number;
  onChange: (value: string) => void;
  onClose: () => void;
  open: boolean;
  options: { disabled?: boolean; icon?: React.ReactNode; label: string; value: string }[];
  searchable?: boolean;
  title: string;
  value: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  if (!open && query) setQuery("");
  const filtered =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;
  return (
    <YStack
      gap="s3"
      flex={heightPercent ? 1 : undefined}
      borderTopLeftRadius="r5"
      borderTopRightRadius="r5"
      backgroundColor="backgroundSoft"
      paddingTop="s5"
      paddingHorizontal="s4"
      paddingBottom="s7 android:s5"
    >
      <YStack gap="s5">
        <Text emphasized headline centered>
          {title}
        </Text>
        {searchable && (
          <XStack
            alignItems="center"
            gap="s2"
            paddingLeft="s3_5"
            borderWidth={1}
            borderColor="borderNeutralSoft"
            borderRadius="r3"
            overflow="hidden"
          >
            <Search size={20} color="uiNeutralPlaceholder" />
            <Input
              flex={1}
              borderWidth={0}
              backgroundColor="transparent"
              placeholderTextColor="uiNeutralPlaceholder"
              placeholder={t("Search")}
              value={query}
              onChangeText={setQuery}
            />
          </XStack>
        )}
      </YStack>
      <ScrollView flex={1} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <YStack gap="s2">
          {filtered.map((option) => (
            <XStack
              key={option.value}
              paddingVertical="s4"
              paddingHorizontal="s3"
              borderRadius="r3"
              backgroundColor={option.value === value ? "interactiveBaseBrandSoftDefault" : "transparent"}
              justifyContent="space-between"
              alignItems="center"
              cursor={option.disabled ? "default" : "pointer"}
              opacity={option.disabled ? 0.5 : "1 press:0.7"}
              aria-disabled={option.disabled}
              onPress={
                option.disabled
                  ? undefined
                  : () => {
                      onChange(option.value);
                      onClose();
                    }
              }
            >
              <XStack alignItems="center" gap="s3">
                {option.icon}
                <Text emphasized headline primary>
                  {option.label}
                </Text>
              </XStack>
              {option.value === value && <Check size={20} color="interactiveBaseBrandDefault" />}
            </XStack>
          ))}
        </YStack>
      </ScrollView>
    </YStack>
  );
}
