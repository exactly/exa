import { ChevronRight, Info } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable } from "react-native";
import { Spinner, XStack, YStack } from "tamagui";

import Text from "./Text";
import View from "./View";

export default function InfoAlert({
  title,
  actionText,
  loading,
  onPress,
}: {
  title: string;
  actionText: string;
  loading?: boolean;
  onPress?: () => void;
}) {
  return (
    <XStack
      borderRadius="$r6"
      backgroundColor="$interactiveBaseInformationSoftDefault"
      justifyContent="space-between"
      alignItems="center"
      gap={10}
      flex={1}
    >
      <YStack
        padding={25}
        backgroundColor="$interactiveBaseInformationDefault"
        justifyContent="center"
        alignItems="center"
        borderTopLeftRadius="$r6"
        borderBottomLeftRadius="$r6"
        width="20%"
        height="100%"
      >
        <Info size={32} color="$interactiveOnBaseInformationDefault" />
      </YStack>
      <View gap={10} padding={25} flex={1}>
        <Text subHeadline color="$interactiveOnBaseInformationSoft">
          {title}
        </Text>
        <Pressable
          onPress={() => {
            onPress?.();
          }}
        >
          <XStack gap="$s1" alignItems="center">
            <Text emphasized subHeadline color="$interactiveOnBaseInformationSoft">
              {actionText}
            </Text>
            {loading ? (
              <Spinner color="$interactiveOnBaseInformationSoft" />
            ) : (
              <ChevronRight
                size={16}
                color="$interactiveOnBaseInformationSoft"
                fontWeight="bold"
                strokeWidth={3}
                transform={[{ translateY: 1.2 }]}
              />
            )}
          </XStack>
        </Pressable>
      </View>
    </XStack>
  );
}
