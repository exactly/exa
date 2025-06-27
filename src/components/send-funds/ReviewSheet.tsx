import shortenHex from "@exactly/common/shortenHex";
import { ArrowRight, User } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";

import type { WithdrawDetails } from "./Amount";
import assetLogos from "../../utils/assetLogos";
import type { Withdraw } from "../../utils/queryClient";
import useAspectRatio from "../../utils/useAspectRatio";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ReviewSheet({
  open,
  onClose,
  onSend,
  details: { amount, usdValue, name: assetName },
  canSend,
  isFirstSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: () => void;
  canSend: boolean;
  details: WithdrawDetails;
  isFirstSend: boolean;
}) {
  const aspectRatio = useAspectRatio();
  const { data: withdraw } = useQuery<Withdraw>({ queryKey: ["withdrawal"] });
  const { market, externalAsset } = useAsset(withdraw?.market);
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
                <Text emphasized primary headline textAlign="center">
                  Review transaction
                </Text>
              </YStack>
              <YStack gap="$s3_5">
                <YStack gap="$s4">
                  <Text emphasized footnote color="$uiNeutralSecondary">
                    Sending
                  </Text>
                  <XStack alignItems="center" gap="$s3">
                    <AssetLogo
                      {...(market
                        ? {
                            external: false,
                            uri: assetLogos[assetName as keyof typeof assetLogos],
                            width: 40,
                            height: 40,
                          }
                        : {
                            external: true,
                            source: { uri: externalAsset?.logoURI },
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                          })}
                    />
                    <YStack flex={1}>
                      <Text title color="$uiNeutralPrimary">
                        {amount} {assetName}
                      </Text>
                      <Text subHeadline color="$uiNeutralSecondary">
                        {Number(usdValue).toLocaleString(undefined, {
                          style: "currency",
                          currency: "USD",
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Text>
                    </YStack>
                  </XStack>
                </YStack>
                <YStack gap="$s4">
                  <Text emphasized footnote color="$uiNeutralSecondary">
                    To
                  </Text>
                  <XStack alignItems="center" gap="$s3">
                    <View
                      position="relative"
                      justifyContent="center"
                      alignItems="center"
                      width={40}
                      height={40}
                      backgroundColor="$backgroundBrand"
                      borderRadius="$r_0"
                      padding="$s2"
                    >
                      <User color="$uiNeutralPrimary" size={40} />
                    </View>
                    <YStack>
                      <Text title color="$uiNeutralPrimary" fontFamily="$mono">
                        {shortenHex(withdraw?.receiver ?? "", 3, 5)}
                      </Text>
                      {isFirstSend && (
                        <Text subHeadline color="$uiNeutralSecondary">
                          First time send
                        </Text>
                      )}
                    </YStack>
                  </XStack>
                </YStack>
              </YStack>
              <YStack gap="$s5">
                <Button
                  onPress={onSend}
                  flexBasis={60}
                  contained
                  main
                  spaced
                  fullwidth
                  disabled={!canSend}
                  iconAfter={
                    <ArrowRight color={canSend ? "$interactiveOnBaseBrandDefault" : "$interactiveOnDisabled"} />
                  }
                >
                  Send
                </Button>
                <Pressable onPress={onClose}>
                  <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
                    Close
                  </Text>
                </Pressable>
              </YStack>
            </YStack>
          </SafeView>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
