import { Fingerprint, Wallet } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { ScrollView, YStack } from "tamagui";

import Button from "./Button";
import ModalSheet from "./ModalSheet";
import SafeView from "./SafeView";
import Text from "./Text";

export default function ConnectSheet({
  open,
  onClose,
  title,
  description,
  webAuthnText,
  siweText,
}: {
  open: boolean;
  onClose: (method?: "webauthn" | "siwe") => void;
  title: string;
  description: string;
  webAuthnText: string;
  siweText: string;
}) {
  const { data: hasInjectedProvider } = useQuery({ queryKey: ["has-injected-provider"] });
  return (
    <ModalSheet
      open={open}
      onClose={() => {
        onClose();
      }}
      disableDrag
    >
      <ScrollView>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s5" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s7">
            <YStack gap="$s4">
              <Text primary title3 textAlign="left">
                {title}
              </Text>
              <Text secondary subHeadline textAlign="left">
                {description}
              </Text>
            </YStack>
            <YStack gap="$s4" alignItems="stretch">
              <Button
                onPress={() => {
                  onClose("webauthn");
                }}
                contained
                main
                spaced
                halfWidth
                iconAfter={<Fingerprint size={20} color="$interactiveOnBaseBrandDefault" />}
              >
                {webAuthnText}
              </Button>
              {hasInjectedProvider && (
                <Button
                  onPress={() => {
                    onClose("siwe");
                  }}
                  main
                  spaced
                  halfWidth
                  outlined
                  backgroundColor="$interactiveBaseBrandSoftDefault"
                  color="$interactiveOnBaseBrandSoft"
                  iconAfter={<Wallet size={20} color="$interactiveOnBaseBrandSoft" />}
                >
                  {siweText}
                </Button>
              )}
            </YStack>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
