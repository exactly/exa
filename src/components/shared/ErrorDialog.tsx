import React from "react";
import { useTranslation } from "react-i18next";
import { Platform } from "react-native";

import { AlertDialog, ScrollView, XStack, YStack } from "tamagui";

import Button from "./StyledButton";
import Text from "./Text";
import { Headphones } from "../../generated/icons/Headphones";
import { X } from "../../generated/icons/X";
import useAspectRatio from "../../utils/useAspectRatio";
import useInsets from "../../utils/useInsets";

export default function ErrorDialog({
  open,
  title,
  description,
  action,
  onClose,
  onContact,
}: {
  action?: { icon: React.ComponentProps<typeof Button.Icon>["children"]; label: string; onPress: () => void };
  description: string;
  onClose: () => void;
  onContact?: () => void;
  open: boolean;
  title: string;
}) {
  const { t } = useTranslation();
  const aspectRatio = useAspectRatio();
  const { top, bottom } = useInsets();
  return (
    <AlertDialog open={open}>
      <AlertDialog.Portal
        aspectRatio={`web:${aspectRatio}`}
        justifySelf="web:center"
        padding="web:s4"
        {...(Platform.OS !== "web" && { paddingTop: top, paddingBottom: bottom })}
      >
        <AlertDialog.Overlay
          onPress={onClose}
          key="overlay"
          backgroundColor="black"
          opacity="0.5 enter:0 exit:0"
          transition="default"
        />
        <AlertDialog.Content
          backgroundColor="web:transparent"
          key="content"
          transition={{ preset: "default", opacity: { preset: "default", spring: { overshootClamping: true } } }}
          elevate={false}
          {...(Platform.OS !== "web" && {
            shadowColor: "shadow",
            shadowOpacity: 1,
            shadowRadius: "s5",
            shadowOffset: { width: 0, height: 12 },
            elevation: 24,
          })}
          padding="s0"
          x="0 enter:0 exit:0"
          y="0 enter:-20px exit:10px"
          scale="1 enter:0.9 exit:0.95"
          opacity="1 enter:0 exit:0"
          borderWidth={0}
          margin="s5"
          flexShrink={1}
        >
          <YStack
            backgroundColor="backgroundSoft"
            borderRadius="r6"
            paddingRight="s5"
            paddingBottom="s5"
            paddingLeft="s5"
            paddingTop="s5"
            gap="s5"
            flexShrink={1}
          >
            <XStack alignItems="center" gap="s3" justifyContent="flex-start">
              <AlertDialog.Title>
                <Text emphasized headline>
                  {title}
                </Text>
              </AlertDialog.Title>
            </XStack>
            <YStack gap="s6" flexShrink={1}>
              <ScrollView flexShrink={1}>
                <Text secondary subHeadline>
                  {description}
                </Text>
              </ScrollView>
              <YStack gap="s3">
                {action && (
                  <Button onPress={action.onPress} primary width="100%">
                    <Button.Text>{action.label}</Button.Text>
                    <Button.Icon>{action.icon}</Button.Icon>
                  </Button>
                )}
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
