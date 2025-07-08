import type { Address } from "@exactly/common/validation";
import { TimerReset } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { XStack, YStack } from "tamagui";

import Contact from "./Contact";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RecentContacts({ onContactPress }: { onContactPress: (address: Address) => void }) {
  const { data } = useQuery<{ address: Address; ens: string; lastUsed: Date }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });
  const { t } = useTranslation();
  const contacts = useMemo(() => {
    if (!data) return;
    const seen = new Set<Address>();
    return data.filter((contact) => {
      if (seen.has(contact.address)) return false;
      seen.add(contact.address);
      return true;
    });
  }, [data]);
  return (
    <YStack gap="$s5">
      <XStack gap="$s2" alignItems="center">
        <TimerReset size={20} color="$interactiveBaseBrandDefault" fontWeight="bold" />
        <Text emphasized footnote color="$uiNeutralSecondary">
          {t("Recent")}
        </Text>
      </XStack>
      {contacts ? (
        <View gap="$s3_5">
          {contacts.map((contact) => (
            <Contact key={contact.address} contact={contact} onContactPress={onContactPress} />
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
