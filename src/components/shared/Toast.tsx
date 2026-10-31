import React from "react";

import { Info as InfoIcon } from "@tamagui/lucide-icons-2/icons/Info";
import { Toast, useToastState } from "@tamagui/toast";
import { XStack } from "tamagui";

import Text from "./Text";
import View from "./View";

export default function NotificationToast() {
  const toast = useToastState();
  if (!toast || toast.isHandledNatively) return null;
  const { preset, haptic } = toast.burntOptions ?? {};
  const type =
    preset === "error" || haptic === "error" ? "error" : preset === "done" || haptic === "success" ? "success" : "info";
  return (
    <Toast
      unstyled
      key={toast.id}
      duration={toast.duration}
      enterStyle={{ opacity: 0, scale: 0.5, y: -25 }}
      exitStyle={{ opacity: 0, scale: 1, y: -20 }}
      backgroundColor="$backgroundSoft"
      borderColor={{ success: "$borderSuccessSoft", error: "$borderErrorSoft", info: "$borderInformationSoft" }[type]}
      borderWidth={1}
      opacity={1}
      scale={1}
      transition="quick"
      viewportName={toast.viewportName}
      borderRadius="$r3"
      marginHorizontal="auto"
    >
      <XStack justifyContent="space-between" alignItems="center" backgroundColor="transparent" alignSelf="center">
        <View
          padding="$s4"
          justifyContent="center"
          alignItems="center"
          backgroundColor={
            {
              success: "$interactiveBaseSuccessSoftDefault",
              error: "$interactiveBaseErrorSoftDefault",
              info: "$interactiveBaseInformationSoftDefault",
            }[type]
          }
          borderTopLeftRadius="$r3"
          borderBottomLeftRadius="$r3"
        >
          <InfoIcon
            size={24}
            color={{ success: "$uiSuccessSecondary", error: "$uiErrorSecondary", info: "$uiInfoSecondary" }[type]}
          />
        </View>
        <View padding="$s4">
          <Toast.Title>
            <Text
              footnote
              color={{ success: "$uiSuccessPrimary", error: "$uiErrorPrimary", info: "$uiInfoPrimary" }[type]}
            >
              {toast.title}
            </Text>
          </Toast.Title>
        </View>
      </XStack>
    </Toast>
  );
}
