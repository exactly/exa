import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Platform, StyleSheet } from "react-native";

import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "expo-router";

import { useWindowDimensions, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { ArrowLeft } from "../../generated/icons/ArrowLeft";
import { BoxSelect } from "../../generated/icons/BoxSelect";
import { SwitchCamera } from "../../generated/icons/SwitchCamera";
import reportError from "../../utils/reportError";
import useInsets from "../../utils/useInsets";
import zxing from "../../utils/zxing";
import IconButton from "../shared/IconButton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Scanner({ onClose, onScan }: { onClose: () => void; onScan: (data: string) => boolean }) {
  const { top, bottom } = useInsets();
  const { height, width } = useWindowDimensions();

  const [active, setActive] = useState(true);
  const [cameraFacing, setCameraFacing] = useState<"back" | "front">("back");
  const [permission, requestPermission] = useCameraPermissions();
  const {
    isSuccess: ready,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["zxing"],
    queryFn: zxing,
    initialData: Platform.OS === "web" ? undefined : null,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const { t } = useTranslation();
  const lastRef = useRef<string>(undefined);

  useFocusEffect(
    useCallback(() => {
      setActive(true);
      return () => {
        setActive(false);
      };
    }, []),
  );

  if (!permission) return <View fullScreen backgroundColor="backgroundSoft" />;
  if (!permission.granted) {
    if (!permission.canAskAgain) {
      return (
        <View fullScreen justifyContent="center" alignItems="center" backgroundColor="backgroundSoft">
          <BackControl onPress={onClose} />
          <View padded>
            <YStack gap="s4">
              <Text secondary subHeadline textAlign="center">
                {t(
                  "Camera access is currently disabled for Exa App. In order to continue, enable camera access for Exa App from your device settings.",
                )}
              </Text>
              <Button
                primary
                minHeight="auto"
                alignSelf="center"
                onPress={() => {
                  Linking.openSettings().catch(reportError);
                }}
              >
                <Button.Text>{t("Go to Settings")}</Button.Text>
              </Button>
            </YStack>
          </View>
        </View>
      );
    }
    return (
      <View fullScreen justifyContent="center" alignItems="center" backgroundColor="backgroundSoft">
        <BackControl onPress={onClose} />
        <View padded>
          <YStack gap="s4">
            <Text secondary subHeadline textAlign="center">
              {t(
                "Before we continue, we need your permission to access the camera. The camera will only be used for scanning QR codes.",
              )}
            </Text>
            <Text secondary footnote textAlign="center">
              {t("Press “Continue” to proceed or “Back” to cancel.")}
            </Text>
            <Button
              secondary
              alignSelf="center"
              onPress={() => {
                requestPermission().catch((error: unknown) => {
                  reportError(error);
                  onClose();
                });
              }}
            >
              <Button.Text>{t("Continue")}</Button.Text>
            </Button>
          </YStack>
        </View>
      </View>
    );
  }
  return (
    <View fullScreen backgroundColor="backgroundSoft">
      {active && (
        <CameraView
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={
            ready
              ? ({ data }) => {
                  if (lastRef.current === data) return;
                  lastRef.current = data;
                  if (onScan(data)) setActive(false);
                }
              : undefined
          }
          facing={cameraFacing}
          style={styles.cameraView}
        />
      )}
      <View position="absolute" fullScreen justifyContent="center" alignItems="center">
        {isError ? (
          <YStack gap="s4" padding="s4">
            <Text subHeadline color="white" textAlign="center">
              {t("An error occurred. Please try again later.")}
            </Text>
            <Button
              secondary
              alignSelf="center"
              onPress={() => {
                refetch().catch(reportError);
              }}
            >
              <Button.Text>{t("Try again")}</Button.Text>
            </Button>
          </YStack>
        ) : (
          <BoxSelect size={Math.min(width, height) * 0.5} color="white" />
        )}
      </View>
      <Button
        primary
        minHeight="auto"
        padding="s3"
        position="absolute"
        borderRadius="r_0"
        bottom={bottom}
        right="s4"
        hitSlop={15}
        onPress={() => {
          setCameraFacing(cameraFacing === "back" ? "front" : "back");
        }}
      >
        <Button.Icon>
          <SwitchCamera />
        </Button.Icon>
      </Button>
      <View position="absolute" borderRadius="r_0" backgroundColor="transparent" top={top} left="s4" padding="s3">
        <IconButton icon={ArrowLeft} color="white" aria-label={t("Back")} onPress={onClose} />
      </View>
    </View>
  );
}

function BackControl({ onPress }: { onPress: () => void }) {
  const { top } = useInsets();
  const { t } = useTranslation();
  return (
    <XStack
      position="absolute"
      borderRadius="r_0"
      backgroundColor="transparent"
      alignItems="center"
      top={top}
      left="s4"
      padding="s3"
      gap="s2"
      cursor="pointer"
      role="button"
      aria-label={t("Back")}
      onPress={onPress}
    >
      <ArrowLeft size={24} color="uiNeutralPrimary" />
      <Text headline>{t("Back")}</Text>
    </XStack>
  );
}

const styles = StyleSheet.create({ cameraView: { flex: 1 } });
