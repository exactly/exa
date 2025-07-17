import { X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { AlertDialog, XStack, YStack } from "tamagui";

import Button from "./Button";
import Text from "./Text";
import useAspectRatio from "../../utils/useAspectRatio";

export default function ErrorDialog({
  open,
  title,
  description,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  onClose: () => void;
}) {
  const aspectRatio = useAspectRatio();
  return (
    <AlertDialog open={open}>
      <AlertDialog.Portal
        style={Platform.OS === "web" ? { aspectRatio, justifySelf: "center" } : undefined} // eslint-disable-line react-native/no-inline-styles
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
                  {title}
                </Text>
              </AlertDialog.Title>
            </XStack>
            <YStack gap="$s6">
              <YStack gap="$s5">
                <Text secondary subHeadline>
                  {description}
                </Text>
              </YStack>
              <XStack>
                <AlertDialog.Action asChild flex={1}>
                  <Button
                    onPress={onClose}
                    contained
                    main
                    spaced
                    fullwidth
                    danger
                    iconAfter={<X strokeWidth={3} color="$interactiveOnBaseErrorSoft" />}
                  >
                    Close
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
