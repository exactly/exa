import React from "react";
import { Pressable } from "react-native";

import { ChevronRight, Info } from "@tamagui/lucide-icons";
import { Spinner, View, XStack } from "tamagui";

import Text from "./Text";
export default function InfoAlert({
  title,
  actionText,
  loading,
  onPress,
}: {
  actionText?: string;
  loading?: boolean;
  onPress?: () => void;
  title: string;
}) {
  return (
    <XStack borderRadius="$r3" backgroundColor="$interactiveBaseInformationSoftDefault" overflow="hidden">
      <View
        padding="$s4"
        backgroundColor="$interactiveBaseInformationDefault"
        justifyContent="center"
        alignItems="center"
        alignSelf="stretch"
      >
        <Info size={32} color="$interactiveOnBaseInformationDefault" />
      </View>
      <View gap="$s2" padding="$s4" flex={1}>
        <Text subHeadline color="$interactiveOnBaseInformationSoft">
          {title}
        </Text>
        <Pressable
          disabled={loading}
          onPress={() => {
            onPress?.();
          }}
        >
          {actionText && (
            <XStack gap="$s1" alignItems="center">
              <Text emphasized subHeadline color="$interactiveOnBaseInformationSoft">
                {actionText}
              </Text>
              {loading ? (
                <Spinner color="$interactiveOnBaseInformationSoft" />
              ) : (
                <ChevronRight size={16} color="$interactiveOnBaseInformationSoft" strokeWidth={3} />
              )}
            </XStack>
          )}
        </Pressable>
      </View>
    </XStack>
  );
}
