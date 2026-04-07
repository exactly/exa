import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Info, X } from "@tamagui/lucide-icons";
import { XStack } from "tamagui";

import Text from "../shared/Text";
import View from "../shared/View";

export default function DismissableAlert({ text, onDismiss }: { onDismiss: () => void; text: string }) {
  const { t } = useTranslation();
  return (
    <XStack
      borderRadius="$r3"
      backgroundColor="$interactiveBaseInformationDefault"
      borderColor="$borderInformationSoft"
      width="100%"
    >
      <View
        padding="$s4"
        backgroundColor="$interactiveBaseInformationSoftDefault"
        justifyContent="center"
        alignItems="center"
        borderTopLeftRadius="$r3"
        borderBottomLeftRadius="$r3"
        flex={1}
      >
        <Info size={24} color="$interactiveOnBaseInformationSoft" />
      </View>
      <View flex={6} padding="$s4">
        <Text fontSize={15} color="$interactiveOnBaseInformationDefault" paddingRight="$s4">
          {text}
        </Text>
        <View position="absolute" right="$s3" top="$s3">
          <Pressable
            aria-label={t("Dismiss")}
            hitSlop={10}
            onPress={onDismiss}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              width={24}
              height={24}
              borderRadius="$r_0"
              backgroundColor="$interactiveBaseInformationSoftDefault"
              justifyContent="center"
              alignItems="center"
            >
              <X size={18} color="$interactiveOnBaseInformationSoft" />
            </View>
          </Pressable>
        </View>
      </View>
    </XStack>
  );
}
