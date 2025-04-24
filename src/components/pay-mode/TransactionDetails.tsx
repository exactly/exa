import chain from "@exactly/common/generated/chain";
import { format } from "date-fns";
import React from "react";
import { Separator, XStack, YStack } from "tamagui";

import OptimismImage from "../../assets/images/optimism.svg";
import Text from "../shared/Text";

export default function TransactionDetails() {
  return (
    <YStack gap="$s4">
      <YStack gap="$s4">
        <Text emphasized headline>
          Transaction details
        </Text>
        <Separator height={1} borderColor="$borderNeutralSoft" />
      </YStack>
      <YStack gap="$s3_5">
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Network fee
          </Text>
          <Text callout color="$uiSuccessSecondary">
            FREE
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Network
          </Text>
          <XStack gap="$s3" alignItems="center">
            <Text callout color="$uiNeutralPrimary" alignContent="center">
              {chain.name}
            </Text>
            <OptimismImage height={20} width={20} />
          </XStack>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Date
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(new Date(), "yyyy-MM-dd")}
          </Text>
        </XStack>
        <XStack justifyContent="space-between">
          <Text emphasized footnote color="$uiNeutralSecondary">
            Time
          </Text>
          <Text callout color="$uiNeutralPrimary">
            {format(new Date(), "HH:mm:ss")}
          </Text>
        </XStack>
      </YStack>
    </YStack>
  );
}
