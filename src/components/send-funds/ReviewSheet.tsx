import shortenHex from "@exactly/common/shortenHex";
import { Address } from "@exactly/common/validation";
import { ArrowRight, User } from "@tamagui/lucide-icons";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { ScrollView, XStack, YStack } from "tamagui";
import { parse } from "valibot";

import assetLogos from "../../utils/assetLogos";
import useAsset from "../../utils/useAsset";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ReviewSheet({
  open,
  onClose,
  onSend,
  details: { amount, usdValue, symbol },
  canSend,
  isFirstSend,
}: {
  open: boolean;
  onClose: () => void;
  onSend: () => void;
  canSend: boolean;
  details: { external: boolean; symbol?: string; amount: string; usdValue: string };
  isFirstSend: boolean;
}) {
  const { asset, receiver } = useLocalSearchParams();
  const receiverAddress = parse(Address, receiver);
  const { market, externalAsset } = useAsset(parse(Address, asset));
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
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
                          source: { uri: assetLogos[symbol as keyof typeof assetLogos] },
                          width: 40,
                          height: 40,
                        }
                      : {
                          source: { uri: externalAsset?.logoURI },
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                        })}
                  />
                  <YStack flex={1}>
                    <Text title color="$uiNeutralPrimary">
                      {amount} {symbol}
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
                      {shortenHex(receiverAddress, 3, 5)}
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
                iconAfter={<ArrowRight color={canSend ? "$interactiveOnBaseBrandDefault" : "$interactiveOnDisabled"} />}
              >
                {canSend ? "Send" : "Enter valid address"}
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
    </ModalSheet>
  );
}
