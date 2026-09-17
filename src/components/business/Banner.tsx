import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ChevronRight, Clock, ClockAlert } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Tag from "./Tag";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Banner({
  step,
  title,
  description,
  onPress,
}: {
  description: string;
  onPress: () => void;
  step: "action" | "failed" | "pending" | "review" | "unavailable";
  title: string;
}) {
  const { t } = useTranslation();
  const error = step === "action" || step === "failed" || step === "unavailable";
  if (step === "pending") {
    return (
      <Pressable onPress={onPress} style={{ alignSelf: "stretch" }}>
        <XStack
          backgroundColor="$backgroundBrandSoft"
          borderWidth={1}
          borderColor="$borderBrandSoft"
          borderRadius="$r3"
          padding="$s4"
          alignItems="center"
          gap="$s3"
        >
          <YStack flex={1} gap="$s2">
            <Text emphasized headline color="$uiBrandSecondary">
              {title}
            </Text>
            <Text footnote color="$uiBrandSecondary">
              {description}
            </Text>
          </YStack>
          <ChevronRight size={24} color="$interactiveBaseBrandDefault" />
        </XStack>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onPress} style={{ alignSelf: "stretch" }}>
      <XStack
        backgroundColor="$backgroundSoft"
        borderWidth={1}
        borderColor="$borderNeutralSoft"
        borderRadius="$r3"
        padding="$s4"
        alignItems="center"
        gap="$s4"
      >
        <View
          width={40}
          height={40}
          borderRadius="$r3"
          alignItems="center"
          justifyContent="center"
          backgroundColor={error ? "$interactiveBaseErrorSoftDefault" : "$interactiveBaseWarningSoftDefault"}
        >
          {error ? <ClockAlert size={24} color="$uiErrorSecondary" /> : <Clock size={24} color="$uiWarningSecondary" />}
        </View>
        <YStack flex={1} gap="$s2">
          <Tag
            label={
              {
                action: t("Action needed"),
                failed: t("Failed"),
                unavailable: t("Not available"),
                review: t("In review"),
              }[step]
            }
            variant={error ? "error" : "warning"}
          />
          <Text emphasized headline primary>
            {title}
          </Text>
          <Text footnote secondary>
            {description}
          </Text>
        </YStack>
        <ChevronRight size={24} color={error ? "$uiErrorSecondary" : "$uiWarningSecondary"} />
      </XStack>
    </Pressable>
  );
}
