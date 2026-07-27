import React from "react";
import { Pressable } from "react-native";

import { AlertTriangle, ChevronRight, Info } from "@tamagui/lucide-icons";
import { Spinner, View, XStack } from "tamagui";

import Text from "./Text";
export default function InfoAlert({
  title,
  actionText,
  error,
  loading,
  onPress,
}: {
  actionText?: string;
  error?: boolean;
  loading?: boolean;
  onPress?: () => void;
  title: string;
}) {
  const onBase = error ? "$interactiveOnBaseErrorSoft" : "$interactiveOnBaseInformationSoft";
  return (
    <XStack
      borderRadius="$r3"
      backgroundColor={error ? "$interactiveBaseErrorSoftDefault" : "$interactiveBaseInformationSoftDefault"}
      overflow="hidden"
    >
      <View
        padding="$s4"
        backgroundColor={error ? "$interactiveBaseErrorDefault" : "$interactiveBaseInformationDefault"}
        justifyContent="center"
        alignItems="center"
        alignSelf="stretch"
      >
        {error ? (
          <AlertTriangle size={32} color="$interactiveOnBaseErrorDefault" />
        ) : (
          <Info size={32} color="$interactiveOnBaseInformationDefault" />
        )}
      </View>
      <View gap="$s2" padding="$s4" flex={1}>
        <Text subHeadline color={onBase}>
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
              <Text emphasized subHeadline color={onBase}>
                {actionText}
              </Text>
              {loading ? <Spinner color={onBase} /> : <ChevronRight size={16} color={onBase} strokeWidth={3} />}
            </XStack>
          )}
        </Pressable>
      </View>
    </XStack>
  );
}
