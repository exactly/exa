import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  useWindowDimensions,
  type View as RNView,
} from "react-native";
import SVG, { Defs, Mask, Rect } from "react-native-svg";

import { Theme, View, YStack, type ScrollView } from "tamagui";

import Text from "../shared/Text";

export default function InstallmentsSpotlight({
  onDismiss,
  onPress,
  scrollOffset,
  scrollRef,
  targetRef,
}: {
  onDismiss: () => void;
  onPress: () => void;
  scrollOffset: React.RefObject<number>;
  scrollRef: React.RefObject<null | ScrollView>;
  targetRef: React.RefObject<null | RNView>;
}) {
  const { t } = useTranslation();
  const { width: screenWidth, height: windowHeight } = useWindowDimensions();
  const statusBarHeight = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;
  const screenHeight = windowHeight + statusBarHeight;
  const [target, setTarget] = useState<{ height: number; width: number; x: number; y: number }>();
  useEffect(() => {
    let scrolled = false;
    let attempts = 0;
    const id = setInterval(() => {
      if (++attempts > 10) {
        clearInterval(id);
        return;
      }
      targetRef.current?.measureInWindow((x, y, width, height) => {
        if (width > 0 && height > 0 && y >= 0 && y + height <= screenHeight) {
          clearInterval(id);
          setTarget({ x, y, width, height });
          return;
        }
        if (!scrolled) {
          scrolled = true;
          if (width > 0 && height > 0) {
            const contentY = scrollOffset.current + y;
            scrollRef.current?.scrollTo({ y: Math.max(0, contentY - screenHeight / 3), animated: true });
          } else {
            scrollRef.current?.scrollTo({ y: 0, animated: true });
          }
        }
      });
    }, 500);
    return () => clearInterval(id);
  }, [screenHeight, scrollOffset, scrollRef, targetRef]);
  if (!target) return null;
  const cutout = {
    x: target.x - 8,
    y: target.y - 8 + statusBarHeight,
    width: target.width + 16,
    height: target.height + 16,
  };
  const cutoutRadius = cutout.height / 2;
  const tooltipTop = cutout.y + cutout.height + 12;
  const tooltipLeft = Math.max(16, Math.min(cutout.x + cutout.width / 2 - 100, screenWidth - 216));
  const arrowLeft = cutout.x + cutout.width / 2 - tooltipLeft - 6;
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <SVG width={screenWidth} height={screenHeight}>
          <Defs>
            <Mask id="cutout">
              <Rect width={screenWidth} height={screenHeight} fill="white" />
              <Rect
                transform={[{ translateX: cutout.x }, { translateY: cutout.y }]}
                width={cutout.width}
                height={cutout.height}
                rx={cutoutRadius}
                fill="black"
              />
            </Mask>
          </Defs>
          <Rect width={screenWidth} height={screenHeight} fill="rgba(0,0,0,0.56)" mask="url(#cutout)" />
          <Rect
            transform={[{ translateX: cutout.x }, { translateY: cutout.y }]}
            width={cutout.width}
            height={cutout.height}
            rx={cutoutRadius}
            fill="none"
            stroke="white"
            strokeWidth={2}
          />
        </SVG>
      </View>
      <Pressable
        aria-label={t("Tap here to change the number of installments")}
        style={[
          styles.cutoutPress,
          { top: cutout.y, left: cutout.x, width: cutout.width, height: cutout.height, borderRadius: cutoutRadius },
        ]}
        onPress={() => {
          onPress();
          onDismiss();
        }}
      />
      <Theme name="light">
        <YStack
          position="absolute"
          top={tooltipTop}
          left={tooltipLeft}
          width={200}
          backgroundColor="$backgroundSoft"
          borderRadius="$r3"
          padding="$s4"
          shadowColor="$uiNeutralSecondary"
          shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={0.15}
          shadowRadius={8}
          onPress={() => {
            onPress();
            onDismiss();
          }}
        >
          <View
            position="absolute"
            top={-6}
            left={arrowLeft}
            width={12}
            height={12}
            backgroundColor="$backgroundSoft"
            borderRadius={2}
            transform={[{ rotate: "45deg" }]}
          />
          <Text footnote textAlign="center">
            {t("Tap here to change the number of installments")}
          </Text>
        </YStack>
      </Theme>
    </Modal>
  );
}

const styles = StyleSheet.create({ cutoutPress: { position: "absolute" } });
