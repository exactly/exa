import React from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { Headphones } from "@tamagui/lucide-icons-2/icons/Headphones";
import { X } from "@tamagui/lucide-icons-2/icons/X";
import { AlertDialog, XStack, YStack } from "tamagui";

import Button from "./StyledButton";
import Text from "./Text";
import useAspectRatio from "../../utils/useAspectRatio";

export default function ErrorDialog({
  open,
  title,
  description,
  onClose,
  onContact,
}: {
  description: string;
  onClose: () => void;
  onContact?: () => void;
  open: boolean;
  title: string;
}) {
  const { t } = useTranslation();
  const aspectRatio = useAspectRatio();
  return (
    <AlertDialog open={open}>
      <AlertDialog.Portal aspectRatio={`web:${aspectRatio}`} justifySelf="web:center">
        <AlertDialog.Overlay
          onPress={onClose}
          key="overlay"
          backgroundColor="black"
          opacity="0.5 enter:0 exit:0"
          transition="default"
        />
        <AlertDialog.Content
          backgroundColor="web:transparent"
          transition={{ preset: "default", opacity: { preset: "default", spring: { overshootClamping: true } } }}
          x="0 enter:0 exit:0"
          y="0 enter:-20px exit:10px"
          scale="1 enter:0.9 exit:0.95"
          opacity="1 enter:0 exit:0"
          borderWidth={0}
          elevate={false}
          {...(Platform.OS !== "web" && {
            shadowColor: "shadow",
            shadowOpacity: 1,
            shadowRadius: "s5",
            shadowOffset: { width: 0, height: 12 },
            elevation: 24,
          })}
          padding={0}
          margin="s5"
          key="content"
        >
          <YStack
            backgroundColor="backgroundSoft"
            borderRadius="r6"
            paddingRight="s5"
            paddingBottom="s5"
            paddingLeft="s5"
            paddingTop="s5"
            gap="s5"
          >
            <XStack alignItems="center" gap="s3" justifyContent="flex-start">
              <AlertDialog.Title>
                <Text emphasized headline>
                  {title}
                </Text>
              </AlertDialog.Title>
            </XStack>
            <YStack gap="s6">
              <YStack gap="s5">
                <Text secondary subHeadline>
                  {description}
                </Text>
              </YStack>
              <YStack gap="s3">
                {onContact && (
                  <Button onPress={onContact} secondary width="100%">
                    <Button.Text>{t("Contact support")}</Button.Text>
                    <Button.Icon>
                      <Headphones />
                    </Button.Icon>
                  </Button>
                )}
                <AlertDialog.Action asChild>
                  <Button onPress={onClose} dangerSecondary width="100%">
                    <Button.Text>{t("Close")}</Button.Text>
                    <Button.Icon>
                      <X />
                    </Button.Icon>
                  </Button>
                </AlertDialog.Action>
              </YStack>
            </YStack>
          </YStack>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog>
  );
}
