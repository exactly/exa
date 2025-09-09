import { Address } from "@exactly/common/validation";
import { ArrowLeft, BoxSelect, SwitchCamera } from "@tamagui/lucide-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useNavigation } from "expo-router";
import React, { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useWindowDimensions, XStack, YStack } from "tamagui";
import { safeParse } from "valibot";

import type { AppNavigationProperties } from "../../app/(app)/_layout";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Qr() {
  const { top, bottom } = useSafeAreaInsets();
  const navigation = useNavigation<AppNavigationProperties>("/(app)");
  const cameraReference = useRef<CameraView>(null);
  const { height, width } = useWindowDimensions();
  const [cameraFacing, setCameraFacing] = useState<"front" | "back">("back");
  const [permission, requestPermission] = useCameraPermissions();

  if (!permission) return <View fullScreen backgroundColor="$backgroundSoft" />;
  if (!permission.granted) {
    if (!permission.canAskAgain) {
      return (
        <View fullScreen justifyContent="center" alignItems="center" backgroundColor="$backgroundSoft">
          <XStack
            position="absolute"
            borderRadius="$r_0"
            backgroundColor="transparent"
            alignItems="center"
            top={top}
            left="$s4"
            padding="$s3"
            onPress={() => {
              if (navigation.canGoBack()) {
                navigation.goBack();
              } else {
                navigation.replace("send-funds", { screen: "index" });
              }
            }}
            gap="$s2"
          >
            <ArrowLeft size={24} color="white" />
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
                  Linking.openSettings().catch(reportError);
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
          top={top}
          left="$s4"
          padding="$s3"
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.replace("send-funds", { screen: "index" });
            }
          }}
          gap="$s2"
        >
          <ArrowLeft size={24} color="white" />
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
                  reportError(error);
                  navigation.replace("send-funds", { screen: "index" });
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
          if (result.success) navigation.popTo("send-funds", { screen: "asset", params: { receiver: result.output } });
        }}
        facing={cameraFacing}
        style={styles.cameraView}
      />
      <View position="absolute" fullScreen justifyContent="center" alignItems="center">
        <BoxSelect size={Math.min(width, height) * 0.5} color="white" />
      </View>
      <Button
        position="absolute"
        borderRadius="$r_0"
        backgroundColor="$interactiveBaseBrandDefault"
        bottom={bottom}
        right="$s4"
        padding="$s3"
        hitSlop={15}
        onPress={() => {
          setCameraFacing(cameraFacing === "back" ? "front" : "back");
        }}
      >
        <SwitchCamera size={24} color="$interactiveOnBaseBrandDefault" />
      </Button>
      <View position="absolute" borderRadius="$r_0" backgroundColor="transparent" top={top} left="$s4" padding="$s3">
        <Pressable
          hitSlop={15}
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
            } else {
              navigation.replace("send-funds", { screen: "index" });
            }
          }}
        >
          <ArrowLeft size={24} color="white" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ cameraView: { flex: 1 } });
