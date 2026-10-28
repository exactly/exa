import React, { useEffect, useEffectEvent, useState } from "react";
import { BackHandler, Keyboard, Platform } from "react-native";

import { getTokens, Sheet, View } from "tamagui";

import { hold } from "../../utils/useAnnouncement";
import useInsets from "../../utils/useInsets";
import SheetContext from "../context/SheetContext";

export default function ModalSheet({
  open,
  onClose,
  children,
  heightPercent,
  disableDrag = true,
  dismissible = true,
  backgroundColor = "backgroundSoft",
  moveOnKeyboardChange = true,
  scrollsUnderInset = false,
}: {
  backgroundColor?: "backgroundMild" | "backgroundSoft" | "black";
  children: React.ReactNode;
  disableDrag?: boolean;
  dismissible?: boolean;
  heightPercent?: number;
  moveOnKeyboardChange?: boolean;
  onClose: () => void;
  open: boolean;
  scrollsUnderInset?: boolean;
}) {
  const onBack = useEffectEvent(() => {
    onClose();
    return true;
  });
  useEffect(() => {
    if (!open || !dismissible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", onBack);
    return () => subscription.remove();
  }, [open, dismissible]);
  useEffect(() => (open ? hold() : undefined), [open]);
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom={dismissible}
      unmountChildrenWhenHidden
      disableRemoveScroll={!open}
      transition="default"
      dismissOnOverlayPress={dismissible}
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
      snapPoints={heightPercent ? [heightPercent] : undefined}
      snapPointsMode={heightPercent ? "percent" : "fit"}
      zIndex={100_000}
      disableDrag={disableDrag}
      moveOnKeyboardChange={moveOnKeyboardChange}
      modal
    >
      <Sheet.Overlay backgroundColor="#00000090" transition="default" opacity="1 enter:0 exit:0" />
      <Sheet.Container className={Platform.OS === "web" ? "sheet-frame" : undefined}>
        <Sheet.Background />
        <View position="absolute" top="50%" right={0} bottom={0} left={0} backgroundColor={backgroundColor} />
        <SheetContext value>{children}</SheetContext>
        {!scrollsUnderInset && <Inset />}
      </Sheet.Container>
    </Sheet>
  );
}

export function Inset({
  keyboard,
  offset = "s0",
}: {
  keyboard?: boolean;
  offset?: keyof ReturnType<typeof getTokens>["space"];
}) {
  const { bottom } = useInsets();
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", ({ endCoordinates }) => setHeight(endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const { space } = getTokens();
  const inset =
    Platform.OS === "android" ? bottom + space.s6.val : height ? space.s6.val : Math.max(bottom, space.s6.val);
  return <View height={(keyboard ? inset + height : inset) - space[offset].val} />;
}
