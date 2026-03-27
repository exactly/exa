import React from "react";

import { Fingerprint, Wallet } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";
import { base } from "viem/chains";

import chain from "@exactly/common/generated/chain";

import ModalSheet from "./ModalSheet";
import SafeView from "./SafeView";
import Button from "./StyledButton";
import Text from "./Text";

import type { AuthMethod } from "../../utils/queryClient";

export default function ConnectSheet({
  open,
  onClose,
  title,
  description,
  webAuthnText,
  siweText,
}: {
  description: string;
  onClose: (method?: AuthMethod) => void;
  open: boolean;
  siweText: string;
  title: string;
  webAuthnText: string;
}) {
  const { data: isOwnerAvailable } = useQuery({ queryKey: ["is-owner-available"] });
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
              {chain.id === base.id ? null : (
                <Button
                  primary
                  onPress={() => {
                    onClose("webauthn");
                  }}
                >
                  <Button.Text>{webAuthnText}</Button.Text>
                  <Button.Icon>
                    <Fingerprint />
                  </Button.Icon>
                </Button>
              )}
              {isOwnerAvailable ? (
                <Button
                  secondary
                  onPress={() => {
                    onClose("siwe");
                  }}
                >
                  <Button.Text>{siweText}</Button.Text>
                  <Button.Icon>
                    <Wallet />
                  </Button.Icon>
                </Button>
              ) : null}
            </YStack>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
