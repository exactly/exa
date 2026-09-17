import React, { useState } from "react";
import { Pressable } from "react-native";

import { Minus, Plus } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Text from "../shared/Text";

export default function Question({ question, answer }: { answer: string; question: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      aria-expanded={open}
      onPress={() => {
        setOpen(!open);
      }}
    >
      <YStack gap="$s3" paddingVertical="$s4" borderBottomWidth={1} borderBottomColor="$borderNeutralSoft">
        <XStack alignItems="center" gap="$s4">
          <Text subHeadline primary flex={1}>
            {question}
          </Text>
          {open ? (
            <Minus size={20} color="$interactiveBaseBrandDefault" />
          ) : (
            <Plus size={20} color="$interactiveBaseBrandDefault" />
          )}
        </XStack>
        {open && (
          <Text footnote secondary>
            {answer}
          </Text>
        )}
      </YStack>
    </Pressable>
  );
}
