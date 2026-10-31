import React from "react";
import { Platform } from "react-native";

import { Info as InfoIcon } from "@tamagui/lucide-icons-2/icons/Info";
import { Toast } from "@tamagui/toast";
import { getTokens, XStack } from "tamagui";

import Text from "./Text";
import View from "./View";
import useInsets from "../../utils/useInsets";

export default function NotificationToast() {
  const { left, top, right } = useInsets();
  return (
    <Toast native={Platform.OS !== "web"} position="top-center">
      <Toast.Viewport offset={{ top: top || getTokens().space.s4.val, left, right }}>
        <Toast.List
          renderItem={({ toast, index }) => {
            const type = toast.type === "error" || toast.type === "success" ? toast.type : "info";
            return (
              <Toast.Item
                toast={toast}
                index={index}
                backgroundColor="backgroundSoft"
                borderColor={
                  { success: "borderSuccessSoft", error: "borderErrorSoft", info: "borderInformationSoft" }[type]
                }
                borderWidth={1}
                borderRadius="r3"
                marginHorizontal="auto"
              >
                <XStack
                  justifyContent="space-between"
                  alignItems="center"
                  backgroundColor="transparent"
                  alignSelf="center"
                >
                  <View
                    padding="s4"
                    justifyContent="center"
                    alignItems="center"
                    backgroundColor={
                      {
                        success: "interactiveBaseSuccessSoftDefault",
                        error: "interactiveBaseErrorSoftDefault",
                        info: "interactiveBaseInformationSoftDefault",
                      }[type]
                    }
                    borderTopLeftRadius="r3"
                    borderBottomLeftRadius="r3"
                  >
                    <InfoIcon
                      size={getTokens().iconSize.lg.val}
                      color={
                        { success: "uiSuccessSecondary", error: "uiErrorSecondary", info: "uiInfoSecondary" }[type]
                      }
                    />
                  </View>
                  <View padding="s4">
                    <Toast.Title>
                      <Text
                        footnote
                        color={{ success: "uiSuccessPrimary", error: "uiErrorPrimary", info: "uiInfoPrimary" }[type]}
                      >
                        {typeof toast.title === "function" ? toast.title() : toast.title}
                      </Text>
                    </Toast.Title>
                  </View>
                </XStack>
              </Toast.Item>
            );
          }}
        />
      </Toast.Viewport>
    </Toast>
  );
}
