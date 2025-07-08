import type { Address } from "@exactly/common/validation";
import { TimerReset } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";

import Contact from "./Contact";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RecentContacts({ onContactPress }: { onContactPress: (address: Address) => void }) {
  const { data: recentContacts } = useQuery<{ address: Address; ens: string; lastUsed: Date }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });
  const { t } = useTranslation();
  return (
    <YStack gap="$s5">
      <XStack gap="$s2" alignItems="center">
        <TimerReset size={20} color="$interactiveBaseBrandDefault" fontWeight="bold" />
        <Text emphasized footnote color="$uiNeutralSecondary">
          {t("Recent")}
        </Text>
      </XStack>
      {recentContacts ? (
        <View gap="$s3_5">
          {recentContacts
            .filter((contact, index, array) => array.findIndex((c) => c.address === contact.address) === index)
            .map((contact, index) => (
              <Contact key={index} contact={contact} onContactPress={onContactPress} />
            ))}
        </View>
      ) : (
        <View margin="$s2" borderRadius="$r3" backgroundColor="$uiNeutralTertiary" padding="$s3_5" alignSelf="center">
          <Text textAlign="center" subHeadline color="$uiNeutralSecondary">
            {t("No recent contacts.")}
          </Text>
        </View>
      )}
    </YStack>
  );
}
