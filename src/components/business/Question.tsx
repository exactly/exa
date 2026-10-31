import React, { useState } from "react";
import { Pressable } from "react-native";

import { Minus, Plus } from "@tamagui/lucide-icons-2";
import { AnimatePresence, XStack, YStack } from "tamagui";

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
      <YStack gap="$s4">
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
        <AnimatePresence>
          {open && (
            <YStack
              key="answer"
              transition="quick"
              animateOnly={["opacity", "transform"]}
              opacity={1}
              y={0}
              enterStyle={{ opacity: 0, y: -4 }}
            >
              <Text footnote secondary>
                {answer}
              </Text>
            </YStack>
          )}
        </AnimatePresence>
      </YStack>
    </Pressable>
  );
}
