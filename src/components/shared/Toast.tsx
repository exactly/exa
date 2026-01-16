import React from "react";

import { Info as InfoIcon } from "@tamagui/lucide-icons";
import { Toast, useToastState } from "@tamagui/toast";
import { XStack } from "tamagui";

import Text from "./Text";
import View from "./View";

export default function NotificationToast() {
  const toast = useToastState();
  const type = toast?.customData?.type as "error" | "info" | "success" | undefined;
  if (!toast || toast.isHandledNatively) return null;
  return (
    <Toast
      key={toast.id}
      duration={toast.duration}
      enterStyle={{ opacity: 0, scale: 0.5, y: -25 }}
      exitStyle={{ opacity: 0, scale: 1, y: -20 }}
      backgroundColor="$backgroundSoft"
      borderColor={
        type === "success" ? "$borderSuccessSoft" : type === "error" ? "$borderErrorSoft" : "$borderInformationSoft"
      }
      borderWidth={1}
      opacity={1}
      scale={1}
      animation="quicker"
      viewportName={toast.viewportName}
      borderRadius="$s3"
    >
      <XStack justifyContent="space-between" alignItems="center" backgroundColor="transparent" alignSelf="center">
        <View
          padding="$s4"
          justifyContent="center"
          alignItems="center"
          backgroundColor={
            type === "success"
              ? "$interactiveBaseSuccessSoftDefault"
              : type === "error"
                ? "$interactiveBaseErrorSoftDefault"
                : "$interactiveBaseInformationSoftDefault"
          }
          borderTopLeftRadius="$s3"
          borderBottomLeftRadius="$s3"
        >
          <InfoIcon
            size={24}
            color={
              type === "success" ? "$uiSuccessSecondary" : type === "error" ? "$uiErrorSecondary" : "$uiInfoSecondary"
            }
          />
        </View>
        <View padding="$s4">
          <Toast.Title>
            <Text
              footnote
              color={
                type === "success"
                  ? "$uiSuccessPrimary"
                  : type === "error"
                    ? "$uiErrorPrimary"
                    : "$uiInformationPrimary"
              }
            >
              {toast.title}
            </Text>
          </Toast.Title>
        </View>
      </XStack>
    </Toast>
  );
}
