import chain from "@exactly/common/generated/chain";
import { AlertTriangle, CheckCircle, X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";
import { useAccount } from "wagmi";

import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useIntercom from "../../utils/useIntercom";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function CopyAddressSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const aspectRatio = useAspectRatio();
  const { presentArticle } = useIntercom();
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
        <ScrollView $platform-web={{ maxHeight: "100vh" }}>
          <SafeView
            borderTopLeftRadius="$r4"
            borderTopRightRadius="$r4"
            backgroundColor="$backgroundSoft"
            paddingHorizontal="$s5"
            $platform-web={{ paddingVertical: "$s7" }}
            $platform-android={{ paddingBottom: "$s5" }}
          >
            <YStack gap="$s7">
              <YStack gap="$s5">
                <XStack gap="$s3" alignItems="center">
                  <CheckCircle size={24} color="$uiSuccessSecondary" />
                  <Text emphasized primary headline color="$uiSuccessSecondary">
                    Address copied
                  </Text>
                </XStack>
                <Text emphasized secondary subHeadline>
                  Double-check your address before sending funds to avoid losing them.
                </Text>
              </YStack>
              <Text primary title fontFamily="$mono" textAlign="center">
                {address}
              </Text>
              <XStack
                gap="$s4"
                alignItems="flex-start"
                borderTopWidth={1}
                borderTopColor="$borderNeutralSoft"
                paddingTop="$s3"
              >
                <View>
                  <AlertTriangle size={16} width={16} height={16} color="$uiWarningSecondary" />
                </View>
                <XStack flex={1}>
                  <Text emphasized caption2 color="$uiNeutralPlaceholder" textAlign="justify">
                    Only send assets on Optimism ({chain.name}). Sending funds from other networks may cause permanent
                    loss.
                    <Text
                      cursor="pointer"
                      emphasized
                      caption2
                      color="$uiBrandSecondary"
                      onPress={() => {
                        presentArticle("8950801").catch(reportError);
                      }}
                    >
                      &nbsp;Learn more about adding funds.
                    </Text>
                  </Text>
                </XStack>
              </XStack>
              <Button
                onPress={onClose}
                flexBasis={60}
                contained
                main
                spaced
                fullwidth
                iconAfter={<X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
              >
                Close
              </Button>
            </YStack>
          </SafeView>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
