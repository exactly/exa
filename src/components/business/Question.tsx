import React, { useState } from "react";
import { Pressable } from "react-native";

import { AnimatePresence, XStack, YStack } from "tamagui";

import { Minus } from "../../generated/icons/Minus";
import { Plus } from "../../generated/icons/Plus";
import Text from "../shared/Text";

export default function Question({ question, answer }: { answer: string; question: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable
      role="button"
      aria-expanded={open}
      onPress={() => {
        setOpen(!open);
      }}
    >
      <YStack gap="s4">
        <XStack alignItems="center" gap="s4">
          <Text subHeadline primary flex={1}>
            {question}
          </Text>
          {open ? (
            <Minus size={20} color="interactiveBaseBrandDefault" />
          ) : (
            <Plus size={20} color="interactiveBaseBrandDefault" />
          )}
        </XStack>
        <AnimatePresence>
          {open && (
            <YStack
              key="answer"
              transition={{ preset: "quick", properties: "opacity, transform" }}
              opacity="1 enter:0"
              transform="translateY(0px) enter:translateY(-4px)"
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
