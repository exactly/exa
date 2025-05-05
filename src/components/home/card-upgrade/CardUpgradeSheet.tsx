import { X } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import React from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Sheet } from "tamagui";

import ActivateCard from "./ActivateCard";
import Intro from "./Intro";
import UpgradeAccount from "./UpgradeAccount";
import VerifyIdentity from "./VerifyIdentity";
import queryClient from "../../../utils/queryClient";
import SafeView from "../../shared/SafeView";
import View from "../../shared/View";

export default function CardUpgradeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: step } = useQuery<number | undefined>({ queryKey: ["card-upgrade"] });
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
      portalProps={Platform.OS === "web" ? { style: { aspectRatio: 10 / 16, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <SafeView
          paddingTop={0}
          fullScreen
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
        >
          <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
            <Pressable onPress={onClose} hitSlop={15}>
              <X size={25} color="$uiNeutralSecondary" />
            </Pressable>
          </View>
          <ScrollView>
            {step === undefined ? (
              <Intro
                onPress={() => {
                  queryClient.setQueryData(["card-upgrade"], 0);
                }}
              />
            ) : (
              <Step step={step} />
            )}
          </ScrollView>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}

const components = [VerifyIdentity, UpgradeAccount, ActivateCard];

function Step({ step }: { step: number }) {
  return React.createElement(components[step] as React.ComponentType);
}
