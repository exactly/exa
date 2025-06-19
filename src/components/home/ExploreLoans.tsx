import { ArrowRight, XCircle } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";

import queryClient from "../../utils/queryClient";
import { getCard } from "../../utils/server";
import Text from "../shared/Text";

export default function ExploreLoans() {
  const { data: card } = useQuery({ queryKey: ["card", "details"], queryFn: getCard });
  if (!card) return null;
  return (
    <XStack
      backgroundColor="$interactiveBaseBrandDefault"
      borderRadius="$r4"
      alignItems="center"
      overflow="hidden"
      height={142}
      justifyContent="space-between"
      padding="$s4"
      cursor="pointer"
      gap="$s2"
      onPress={() => {
        router.push("/loans");
      }}
    >
      <YStack height="100%" justifyContent="space-between" alignItems="flex-start" zIndex={2} maxWidth="50%">
        <Text textAlign="left" maxFontSizeMultiplier={1} emphasized body color="$backgroundBrandSoft">
          Get a fixed-rate loan without selling your crypto
        </Text>
        <XStack alignSelf="flex-start" alignItems="center" gap="$s2">
          <Text emphasized footnote color="$interactiveBaseBrandSoftDefault" maxFontSizeMultiplier={1}>
            Explore loan options
          </Text>
          <ArrowRight size={16} color="$interactiveBaseBrandSoftDefault" />
        </XStack>
      </YStack>
      <XStack
        position="absolute"
        right="$s4"
        top="$s4"
        justifyContent="flex-end"
        cursor="pointer"
        zIndex={3}
        onPress={(event) => {
          event.stopPropagation();
          queryClient.setQueryData(["settings", "explore-loans-shown"], false);
        }}
      >
        <XCircle size={20} color="$backgroundBrandSoft" />
      </XStack>
    </XStack>
  );
}
