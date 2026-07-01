import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { Check, Search } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import Input from "./Input";
import ModalSheet from "./ModalSheet";
import Text from "./Text";

export default function SelectSheet({
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
  options: { label: string; value: string }[];
  searchable?: boolean;
  title: string;
  value: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const filtered =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;
  function close() {
    setQuery("");
    onClose();
  }
  return (
    <ModalSheet open={open} onClose={close} disableDrag heightPercent={heightPercent}>
      <YStack
        gap="$s5"
        flex={heightPercent ? 1 : undefined}
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        paddingTop="$s7"
        paddingHorizontal="$s5"
        paddingBottom="$s7"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <Text emphasized headline>
          {title}
        </Text>
        {searchable && (
          <XStack
            alignItems="center"
            gap="$s2"
            paddingHorizontal="$s3"
            borderWidth={1}
            borderColor="$borderNeutralSoft"
            borderRadius="$r3"
          >
            <Search size={16} color="$uiNeutralSecondary" />
            <Input
              flex={1}
              borderWidth={0}
              backgroundColor="transparent"
              placeholder={t("Search")}
              value={query}
              onChangeText={setQuery}
            />
          </XStack>
        )}
        <ScrollView flex={1} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <YStack gap="$s2">
            {filtered.map((option) => (
              <XStack
                key={option.value}
                padding="$s4"
                borderRadius="$r3"
                backgroundColor={option.value === value ? "$interactiveBaseBrandSoftDefault" : "transparent"}
                justifyContent="space-between"
                alignItems="center"
                cursor="pointer"
                pressStyle={{ opacity: 0.7 }}
                onPress={() => {
                  onChange(option.value);
                  close();
                }}
              >
                <Text emphasized headline primary>
                  {option.label}
                </Text>
                {option.value === value && <Check size={20} color="$interactiveBaseBrandDefault" />}
              </XStack>
            ))}
          </YStack>
        </ScrollView>
      </YStack>
    </ModalSheet>
  );
}
