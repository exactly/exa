import { Fingerprint, Wallet } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { ScrollView, Sheet, YStack } from "tamagui";

import Button from "./Button";
import SafeView from "./SafeView";
import Text from "./Text";
import useAspectRatio from "../../utils/useAspectRatio";

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
  const aspectRatio = useAspectRatio();
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={() => {
        onClose();
      }}
      snapPointsMode="fit"
      zIndex={100_000}
      disableDrag
      modal
      portalProps={Platform.OS === "web" ? { style: { aspectRatio, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
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
              </YStack>
            </YStack>
          </SafeView>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
