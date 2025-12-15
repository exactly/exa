import type { Address } from "@exactly/common/validation";
import { TimerReset } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { XStack, YStack } from "tamagui";

import Contact from "./Contact";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RecentContacts({ onContactPress }: { onContactPress: (address: Address) => void }) {
  const { data: recentContacts } = useQuery<{ address: Address; ens: string; lastUsed: Date }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });
  return (
    <YStack gap="$s5">
      <XStack gap="$s2" alignItems="center">
        <TimerReset size={20} color="$interactiveBaseBrandDefault" fontWeight="bold" />
        <Text emphasized footnote color="$uiNeutralSecondary">
          Recent
        </Text>
      </XStack>
      {recentContacts ? (
        <View gap="$s3_5">
          {recentContacts
            .filter((contact, index, array) => array.findIndex((c) => c.address === contact.address) === index)
            .map((contact) => (
              <Contact key={contact.address} contact={contact} onContactPress={onContactPress} />
            ))}
        </View>
      ) : (
        <View margin="$s2" borderRadius="$r3" backgroundColor="$uiNeutralTertiary" padding="$s3_5" alignSelf="center">
          <Text textAlign="center" subHeadline color="$uiNeutralSecondary">
            No recent contacts.
          </Text>
        </View>
      )}
    </YStack>
  );
}
