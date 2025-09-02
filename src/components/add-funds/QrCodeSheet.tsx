import chain from "@exactly/common/generated/chain";
import { X } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import QRCodeStyled, { type BitMatrix } from "react-native-qrcode-styled";
import { Circle, G } from "react-native-svg";
import { ScrollView, Sheet, XStack, YStack } from "tamagui";
import { useAccount } from "wagmi";

import OptimismImage from "../../assets/images/optimism.svg";
import assetLogos from "../../utils/assetLogos";
import useAspectRatio from "../../utils/useAspectRatio";
import AssetLogo from "../shared/AssetLogo";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

const supportedAssets = Object.entries(assetLogos)
  .filter(([symbol]) => symbol !== "USDC.e" && symbol !== "DAI")
  .map(([symbol, image]) => ({ symbol, image }));

export default function QrCodeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { address } = useAccount();
  const aspectRatio = useAspectRatio();
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
              <Text emphasized primary headline>
                QR Code
              </Text>
              <View alignSelf="center" borderRadius="$r5" backgroundColor="white">
                <QRCodeStyled data={address} size={200} padding={20}>
                  {(pieceSize: number, bitMatrix: BitMatrix) => {
                    const qrSize = pieceSize * bitMatrix.length;
                    const logoSize = qrSize * 0.22;
                    const circleRadius = logoSize / 2 + 4;
                    const center = qrSize / 2;
                    return (
                      <G>
                        <Circle cx={center} cy={center} r={circleRadius} fill="white" />
                        <G x={center - logoSize / 2} y={center - logoSize / 2}>
                          <OptimismImage width={logoSize} height={logoSize} />
                        </G>
                      </G>
                    );
                  }}
                </QRCodeStyled>
              </View>
              <YStack gap="$s5">
                <XStack
                  justifyContent="space-between"
                  alignItems="center"
                  borderTopWidth={1}
                  borderTopColor="$borderNeutralSoft"
                  paddingTop="$s6"
                >
                  <Text emphasized footnote color="$uiNeutralSecondary" textAlign="left">
                    Network
                  </Text>
                  <Text emphasized footnote color="$uiNeutralSecondary" textAlign="right">
                    Supported Assets
                  </Text>
                </XStack>
                <XStack gap="$s5" justifyContent="space-between" alignItems="center">
                  <XStack alignItems="center" gap="$s3" flex={1}>
                    <OptimismImage height={32} width={32} />
                    <Text emphasized primary headline>
                      {chain.name}
                    </Text>
                  </XStack>
                  <XStack
                    borderWidth={1}
                    borderColor="$borderNeutralSoft"
                    borderRadius="$r_0"
                    padding="$s3_5"
                    alignSelf="flex-end"
                  >
                    {supportedAssets.map((asset, index) => {
                      return (
                        <XStack key={index} marginRight={index < supportedAssets.length - 1 ? -12 : 0} zIndex={index}>
                          <AssetLogo uri={asset.image} width={32} height={32} />
                        </XStack>
                      );
                    })}
                  </XStack>
                </XStack>
              </YStack>
              <Button onPress={onClose} flexBasis={60} secondary>
                <Button.Text>Close</Button.Text>
                <Button.Icon>
                  <X strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />
                </Button.Icon>
              </Button>
            </YStack>
          </SafeView>
        </ScrollView>
      </Sheet.Frame>
    </Sheet>
  );
}
