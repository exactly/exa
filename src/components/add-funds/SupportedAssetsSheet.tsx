import chain from "@exactly/common/generated/chain";
import { AlertTriangle, X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";

import assetLogos from "../../utils/assetLogos";
import reportError from "../../utils/reportError";
import useAspectRatio from "../../utils/useAspectRatio";
import useIntercom from "../../utils/useIntercom";
import AssetLogo from "../shared/AssetLogo";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

const supportedAssets = Object.entries(assetLogos)
  .filter(([symbol]) => symbol !== "USDC.e" && symbol !== "DAI")
  .map(([symbol, image]) => ({ symbol, image }));

export default function SupportedAssetsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
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
              <YStack>
                <Text emphasized primary headline>
                  Supported assets
                </Text>
              </YStack>
              <XStack justifyContent="center" flexWrap="wrap">
                {supportedAssets.map((asset, index) => {
                  return (
                    <XStack
                      key={index}
                      borderWidth={1}
                      alignItems="center"
                      borderColor="$borderNeutralSoft"
                      borderRadius="$r_0"
                      alignSelf="center"
                      padding="$s3_5"
                      margin="$s3"
                      gap="$s2"
                    >
                      <AssetLogo uri={asset.image} width={32} height={32} />
                      <Text primary emphasized callout>
                        {asset.symbol}
                      </Text>
                    </XStack>
                  );
                })}
              </XStack>
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
                    Only send assets on {chain.name}. Sending funds from other networks may cause permanent loss.
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
