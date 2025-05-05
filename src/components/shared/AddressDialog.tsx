import chain from "@exactly/common/generated/chain";
import { Copy } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { AlertDialog, XStack, YStack } from "tamagui";

import Button from "./Button";
import Text from "./Text";
import View from "./View";
import OptimismImage from "../../assets/images/optimism.svg";

export default function AddressDialog({
  open,
  onActionPress,
  onClose,
}: {
  open: boolean;
  onActionPress: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={open}>
      <AlertDialog.Portal
        style={Platform.OS === "web" ? { aspectRatio: 10 / 16, justifySelf: "center" } : undefined} // eslint-disable-line react-native/no-inline-styles
      >
        <AlertDialog.Overlay
          onPress={onClose}
          key="overlay"
          backgroundColor="black"
          opacity={0.5}
          animation="quicker"
          enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
          exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        />
        <AlertDialog.Content
          style={Platform.OS === "web" ? { backgroundColor: "transparent" } : undefined} // eslint-disable-line react-native/no-inline-styles, react-native/no-color-literals
          key="content"
          animation={["quicker", { opacity: { overshootClamping: true } }]}
          enterStyle={{ x: 0, y: -20, opacity: 0, scale: 0.9 }} // eslint-disable-line react-native/no-inline-styles
          exitStyle={{ x: 0, y: 10, opacity: 0, scale: 0.95 }} // eslint-disable-line react-native/no-inline-styles
          x={0}
          y={0}
          scale={1}
          opacity={1}
          borderWidth={0}
          margin="$s5"
        >
          <YStack backgroundColor="$backgroundSoft" borderRadius="$r6" padding="$s5" paddingTop="$s5" gap="$s5">
            <XStack alignItems="center" gap="$s3" justifyContent="flex-start">
              <AlertDialog.Title>
                <Text emphasized headline>
                  Network reminder
                </Text>
              </AlertDialog.Title>
            </XStack>
            <YStack gap="$s6">
              <YStack gap="$s5">
                <XStack gap="$s3" alignItems="center">
                  <View alignItems="center" justifyContent="center">
                    <OptimismImage height={32} width={32} />
                  </View>
                  <Text>
                    <Text emphasized title3>
                      {chain.name}
                    </Text>
                  </Text>
                </XStack>
                <Text secondary subHeadline>
                  Add funds using
                  <Text emphasized secondary>
                    &nbsp;{chain.name}&nbsp;
                  </Text>
                  only. Sending assets on any other network will cause irreversible loss of funds.
                </Text>
              </YStack>
              <XStack>
                <AlertDialog.Action asChild flex={1}>
                  <Button
                    onPress={onActionPress}
                    contained
                    main
                    spaced
                    fullwidth
                    iconAfter={<Copy strokeWidth={3} color="$interactiveOnBaseBrandDefault" />}
                  >
                    Copy account address
                  </Button>
                </AlertDialog.Action>
              </XStack>
            </YStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
