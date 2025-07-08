import { ArrowRight, Check, Info, X } from "@tamagui/lucide-icons";
import React, { useEffect, useState } from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";

import Connect from "../../assets/images/connect.svg";
import useAspectRatio from "../../utils/useAspectRatio";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ConnectionSheet({
  open,
  onClose,
  title,
  disclaimer,
  terms,
  actionText,
  onActionPress,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  disclaimer: React.ReactNode;
  terms: React.ReactNode;
  actionText: string;
  onActionPress: () => void;
}) {
  const aspectRatio = useAspectRatio();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setAcknowledged(!open);
  }, [open]);

  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
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
        <SafeView
          paddingTop={0}
          $platform-web={{ paddingBottom: "$s4" }}
          fullScreen
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
        >
          <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
            <Pressable onPress={onClose} hitSlop={15}>
              <X size={25} color="$uiNeutralSecondary" />
            </Pressable>
          </View>
          <ScrollView $platform-web={{ maxHeight: "100vh" }}>
            <View fullScreen flex={1}>
              <YStack flex={1} padding="$s4" gap="$s6">
                <YStack flex={1} justifyContent="center">
                  <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                    <Connect width="100%" height="100%" />
                  </View>
                  <YStack gap="$s4" alignSelf="center">
                    <Text emphasized textAlign="center" color="$interactiveTextBrandDefault" title>
                      {title}
                    </Text>
                  </YStack>
                </YStack>
                <YStack gap="$s4_5">
                  <XStack alignItems="center" gap="$s4">
                    <XStack>
                      <Info size="$iconSize.md" strokeWidth="$iconStroke.md" color="$uiInfoSecondary" />
                    </XStack>
                    <XStack flex={1}>{disclaimer}</XStack>
                  </XStack>
                  <XStack
                    alignItems="center"
                    gap="$s4"
                    flex={1}
                    justifyContent="flex-start"
                    onPress={() => {
                      setAcknowledged(!acknowledged);
                    }}
                  >
                    <XStack cursor="pointer">
                      <View
                        width={16}
                        height={16}
                        backgroundColor={acknowledged ? "$backgroundBrand" : "transparent"}
                        borderColor="$backgroundBrand"
                        borderWidth={1}
                        borderRadius="$r2"
                        justifyContent="center"
                        alignItems="center"
                      >
                        {acknowledged && <Check size="$iconSize.xs" color="white" />}
                      </View>
                    </XStack>
                    {terms}
                  </XStack>
                  <Button onPress={onActionPress} primary disabled={!acknowledged}>
                    <Button.Text>{actionText}</Button.Text>
                    <Button.Icon>
                      <ArrowRight />
                    </Button.Icon>
                  </Button>
                </YStack>
              </YStack>
            </View>
          </ScrollView>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
