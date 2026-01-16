import React from "react";
import { Pressable } from "react-native";

import { ChevronRight, Info } from "@tamagui/lucide-icons";
import { Spinner, Text, View, XStack } from "tamagui";

export default function InfoAlert({
  title,
  actionText,
  loading,
  onPress,
}: {
  actionText: string;
  loading?: boolean;
  onPress?: () => void;
  title: string;
}) {
  return (
    <View
      borderRadius="$r6"
      flexDirection="row"
      backgroundColor="$interactiveBaseInformationSoftDefault"
      justifyContent="space-between"
      alignItems="center"
      gap={10}
      flex={1}
    >
      <View
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
      </View>
      <View gap={10} padding={25} flex={1}>
        <Text fontSize={15} color="$interactiveOnBaseInformationSoft">
          {title}
        </Text>
        <Pressable
          onPress={() => {
            onPress?.();
          }}
        >
          <XStack flexDirection="row" gap={2} alignItems="center">
            <Text color="$interactiveOnBaseInformationSoft" fontSize={15} fontWeight="bold">
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
    </View>
  );
}
