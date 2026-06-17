import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Headphones } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { newMessage } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function TimeoutSheet({
  failureCount,
  pending,
  signal = 0,
  submittedAt,
}: {
  failureCount: number;
  pending: boolean;
  signal?: number;
  submittedAt: number;
}) {
  const { t } = useTranslation();
  const { data: contacted } = useQuery<boolean>({ queryKey: ["settings", "card-support-contacted"] });
  const key = `${submittedAt}:${signal}`;
  const [dismissedKey, setDismissedKey] = useState<null | string>(null);
  const messageRef = useRef<null | string>(null);
  const dismiss = () => setDismissedKey(key);
  function contact() {
    messageRef.current = t(
      "Hi! I'm setting up my Exa Card and it's taking longer than expected. Could you check on its status?",
    );
    setDismissedKey(key);
  }

  const open = pending && failureCount >= 5 && dismissedKey !== key;
  return (
    <ModalSheet open={open} onClose={dismiss} disableDrag>
      <YStack
        gap="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5" paddingTop="$s7" paddingHorizontal="$s5">
          <Text emphasized headline>
            {t("Taking longer than usual")}
          </Text>
          <Text subHeadline color="$uiNeutralSecondary">
            {contacted
              ? t(
                  "Thanks for reaching out. Our team will reply soon. You can keep waiting while your card finishes setting up.",
                )
              : t(
                  "Your card is still being set up. This is taking a bit longer than expected. You can keep waiting or reach out to our support team.",
                )}
          </Text>
        </YStack>
        <YStack gap="$s5" paddingHorizontal="$s5" paddingBottom="$s7">
          <Button primary width="100%" onPress={contacted ? dismiss : contact}>
            <Button.Text>{contacted ? t("Keep waiting") : t("Contact support")}</Button.Text>
            {!contacted && (
              <Button.Icon>
                <Headphones />
              </Button.Icon>
            )}
          </Button>
          <Text
            cursor="pointer"
            emphasized
            footnote
            color="$interactiveBaseBrandDefault"
            textAlign="center"
            onPress={contacted ? contact : dismiss}
          >
            {contacted ? t("Contact support again") : t("Keep waiting")}
          </Text>
        </YStack>
      </YStack>
      <OnHidden message={messageRef} />
    </ModalSheet>
  );
}

function OnHidden({ message }: { message: { current: null | string } }) {
  useEffect(() => {
    return () => {
      const text = message.current;
      if (text === null) return;
      message.current = null;
      newMessage(text)
        .then((presented) => {
          if (presented) queryClient.setQueryData<boolean>(["settings", "card-support-contacted"], true);
        })
        .catch(reportError);
    };
  }, [message]);
  return null;
}
