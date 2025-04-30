import MAX_INSTALLMENTS from "@exactly/common/MAX_INSTALLMENTS";
import { ArrowRight } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { XStack, YStack } from "tamagui";

import Loans from "../../assets/images/loans.svg";
import Text from "../shared/Text";
import View from "../shared/View";

export default function GetALoan() {
  return (
    <XStack
      backgroundColor="$backgroundSoft"
      borderRadius="$s3"
      alignItems="center"
      padding="$s4"
      justifyContent="space-between"
      flexWrap="wrap"
      $platform-web={{ flexWrap: "nowrap" }}
    >
      <YStack gap="$s7" flex={4}>
        <YStack>
          <Text emphasized body primary>
            Get a loan
          </Text>
        </YStack>
        <YStack gap="$s4">
          <Text footnote>Repay in up to {MAX_INSTALLMENTS} fixed-rate installments and use it however you want.</Text>
          <XStack
            alignItems="center"
            gap="$s2"
            cursor="pointer"
            onPress={() => {
              router.push("/(app)/loan");
            }}
          >
            <Text emphasized footnote color="$interactiveOnBaseBrandSoft">
              Explore loan options
            </Text>
            <ArrowRight width={16} height={16} color="$interactiveOnBaseBrandSoft" />
          </XStack>
        </YStack>
      </YStack>
      <YStack gap="$s7" flex={3}>
        <View flex={1} justifyContent="center" alignItems="center">
          <Loans width="100%" height="100%" />
        </View>
      </YStack>
    </XStack>
  );
}
