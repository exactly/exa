import React, { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Platform, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";

import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "expo-router";

import { getTokens, useWindowDimensions, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import { ArrowLeft } from "../../generated/icons/ArrowLeft";
import { BoxSelect } from "../../generated/icons/BoxSelect";
import { SwitchCamera } from "../../generated/icons/SwitchCamera";
import { X } from "../../generated/icons/X";
import reportError from "../../utils/reportError";
import useInsets from "../../utils/useInsets";
import zxing from "../../utils/zxing";
import IconButton from "../shared/IconButton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Scanner({
  children,
  framed = false,
  onClose,
  onScan,
  paused = false,
}: {
  children?: React.ReactNode;
  framed?: boolean;
  onClose: () => void;
  onScan: (data: string) => boolean;
  paused?: boolean;
}) {
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
  const handledRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      lastRef.current = undefined;
      handledRef.current = false;
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
            ready && !paused
              ? ({ data }) => {
                  if (handledRef.current || lastRef.current === data) return;
                  lastRef.current = data;
                  if (!onScan(data)) return;
                  handledRef.current = true;
                  setActive(false);
                }
              : undefined
          }
          facing={cameraFacing}
          style={styles.cameraView}
        />
      )}
      {framed && !isError && <Frame width={width} height={height} />}
      <View position="absolute" fullScreen justifyContent="center" alignItems="center" gap="s5">
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
        ) : framed ? null : (
          <BoxSelect size={Math.min(width, height) * 0.5} color="white" />
        )}
        {!framed && children}
      </View>
      {framed && (
        <View position="absolute" left={0} right={0} bottom={bottom + 40} alignItems="center">
          {children}
        </View>
      )}
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
      {framed ? (
        <View
          position="absolute"
          top={top + 8}
          right="s4"
          width={40}
          height={40}
          borderRadius="r_0"
          justifyContent="center"
          alignItems="center"
          backgroundColor="$grayscaleLight11"
        >
          <IconButton
            icon={X}
            color={getTokens().color.grayscaleLight1.val}
            aria-label={t("Close")}
            onPress={onClose}
          />
        </View>
      ) : (
        <View position="absolute" borderRadius="r_0" backgroundColor="transparent" top={top} left="s4" padding="s3">
          <IconButton icon={ArrowLeft} color="white" aria-label={t("Back")} onPress={onClose} />
        </View>
      )}
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

function Frame({ width, height }: { height: number; width: number }) {
  const hole = Math.min(width, height) * (288 / 390);
  const x = (width - hole) / 2;
  const y = (height - hole) / 2;
  const radius = 16;
  const corners = hole * (340 / 288);
  return (
    <>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path
          fill={getTokens().color.grayscaleLight12.val}
          fillOpacity={0.8}
          fillRule="evenodd"
          d={`M0 0H${width}V${height}H0Z M${x + radius} ${y}H${x + hole - radius}A${radius} ${radius} 0 0 1 ${x + hole} ${y + radius}V${y + hole - radius}A${radius} ${radius} 0 0 1 ${x + hole - radius} ${y + hole}H${x + radius}A${radius} ${radius} 0 0 1 ${x} ${y + hole - radius}V${y + radius}A${radius} ${radius} 0 0 1 ${x + radius} ${y}Z`}
        />
      </Svg>
      <View position="absolute" fullScreen justifyContent="center" alignItems="center" pointerEvents="none">
        <Svg width={corners} height={corners} viewBox="0 0 340 340">
          {cornerPaths.map((d) => (
            <Path key={d} d={d} fill={getTokens().color.grayscaleLight6.val} />
          ))}
        </Svg>
      </View>
    </>
  );
}

const cornerPaths = [
  "M10 310C10 321.046 18.9543 330 30 330H57C59.7614 330 62 332.239 62 335C62 337.761 59.7614 340 57 340H30C13.4315 340 0 326.569 0 310V283C0 280.239 2.23858 278 5 278C7.76142 278 10 280.239 10 283V310Z",
  "M340 310C340 326.569 326.569 340 310 340H283C280.239 340 278 337.761 278 335C278 332.239 280.239 330 283 330H310C321.046 330 330 321.046 330 310V283C330 280.239 332.239 278 335 278C337.761 278 340 280.239 340 283V310Z",
  "M62 5C62 7.76142 59.7614 10 57 10H30C18.9543 10 10 18.9543 10 30V57C10 59.7614 7.76142 62 5 62C2.23858 62 0 59.7614 0 57V30C0 13.4315 13.4315 0 30 0H57C59.7614 0 62 2.23858 62 5Z",
  "M310 0C326.569 0 340 13.4315 340 30V57C340 59.7614 337.761 62 335 62C332.239 62 330 59.7614 330 57V30C330 18.9543 321.046 10 310 10H283C280.239 10 278 7.76142 278 5C278 2.23858 280.239 0 283 0H310Z",
];

const styles = StyleSheet.create({ cameraView: { flex: 1 } });
