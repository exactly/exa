import type { Address } from "@exactly/common/validation";
import { BookUser } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { XStack, YStack } from "tamagui";

import Contact from "./Contact";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Contacts({ onContactPress }: { onContactPress: (address: Address) => void }) {
  const { data: savedContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "saved"],
  });
  return (
    <YStack gap="$s5">
      <XStack gap="$s2" alignItems="center">
        <BookUser size={20} color="$interactiveBaseBrandDefault" fontWeight="bold" />
        <Text emphasized footnote color="$uiNeutralSecondary">
          Contacts
        </Text>
      </XStack>
      {savedContacts ? (
        <View gap="$s3_5">
          {savedContacts.map((contact) => (
            <Contact key={contact.address} contact={contact} onContactPress={onContactPress} />
          ))}
        </View>
      ) : (
        <View margin="$s2" borderRadius="$r3" backgroundColor="$uiNeutralTertiary" padding="$s3_5" alignSelf="center">
          <Text textAlign="center" subHeadline color="$uiNeutralSecondary">
            No saved contacts.
          </Text>
        </View>
      )}
    </YStack>
  );
}
