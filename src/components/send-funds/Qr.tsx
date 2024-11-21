import { Address } from "@exactly/common/validation";
import { ArrowLeft, BoxSelect, SwitchCamera } from "@tamagui/lucide-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import { Linking, StyleSheet } from "react-native";
import { ms } from "react-native-size-matters";
import { useWindowDimensions, XStack, YStack } from "tamagui";
import { safeParse } from "valibot";

import handleError from "../../utils/handleError";
import Button from "../shared/Button";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Qr() {
  const cameraReference = useRef<CameraView>(null);
  const { height, width } = useWindowDimensions();
  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("back");
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) {
    return <View fullScreen backgroundColor="$backgroundSoft" />;
  }

  if (!permission.granted) {
    if (!permission.canAskAgain) {
      return (
        <View fullScreen justifyContent="center" alignItems="center" backgroundColor="$backgroundSoft">
          <XStack
            position="absolute"
            borderRadius="$r_0"
            backgroundColor="transparent"
            alignItems="center"
            top="$s4"
            left="$s4"
            padding="$s3"
            onPress={() => {
              router.back();
            }}
            gap="$s2"
          >
            <ArrowLeft size={ms(24)} color="white" />
            <Text headline>Back</Text>
          </XStack>
          <View padded>
            <YStack gap="$s4">
              <Text secondary subHeadline textAlign="center">
                Camera access is currently disabled for Exa App. In order to continue, enable camera access for Exa App
                from your device settings.
              </Text>
              <Button
                alignSelf="center"
                onPress={() => {
                  Linking.openSettings().catch(handleError);
                }}
              >
                Go to Settings
              </Button>
            </YStack>
          </View>
        </View>
      );
    }
    return (
      <View fullScreen justifyContent="center" alignItems="center" backgroundColor="$backgroundSoft">
        <XStack
          position="absolute"
          borderRadius="$r_0"
          backgroundColor="transparent"
          alignItems="center"
          top="$s4"
          left="$s4"
          padding="$s3"
          onPress={() => {
            router.back();
          }}
          gap="$s2"
        >
          <ArrowLeft size={ms(24)} color="white" />
          <Text headline>Back</Text>
        </XStack>
        <View padded>
          <YStack gap="$s4">
            <Text secondary subHeadline textAlign="center">
              Before we continue, we need your permission to access the camera. The camera will only be used for
              scanning valid addresses.
            </Text>
            <Text secondary footnote textAlign="center">
              Press &apos;Continue&apos; to proceed or &apos;Back&apos; to cancel.
            </Text>
            <Button
              alignSelf="center"
              onPress={() => {
                requestPermission().catch((error: unknown) => {
                  handleError(error);
                  router.back();
                });
              }}
              outlined
            >
              Continue
            </Button>
          </YStack>
        </View>
      </View>
    );
  }

  return (
    <View fullScreen backgroundColor="$backgroundSoft">
      <CameraView
        ref={cameraReference}
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data: receiver }) => {
          const result = safeParse(Address, receiver);
          if (result.success) {
            router.navigate({ pathname: "/send-funds", params: { receiver: result.output } });
          }
        }}
        facing={cameraFacing}
        style={styles.cameraView}
      />
      <Button
        position="absolute"
        borderRadius="$r_0"
        backgroundColor="$interactiveBaseBrandDefault"
        bottom="$s4"
        right="$s4"
        padding="$s3"
        onPress={() => {
          setCameraFacing(cameraFacing === "back" ? "front" : "back");
        }}
      >
        <SwitchCamera size={ms(24)} color="$interactiveOnBaseBrandDefault" />
      </Button>
      <View
        position="absolute"
        borderRadius="$r_0"
        backgroundColor="transparent"
        top="$s4"
        left="$s4"
        padding="$s3"
        onPress={() => {
          router.back();
        }}
      >
        <ArrowLeft size={ms(24)} color="white" />
      </View>
      <View position="absolute" fullScreen justifyContent="center" alignItems="center">
        <BoxSelect size={ms(Math.min(width, height) * 0.5)} color="white" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ cameraView: { flex: 1 } });
