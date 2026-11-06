import React, { createContext, use, useEffect, useLayoutEffect, useState } from "react";
import { Keyboard, Modal, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { FullWindowOverlay } from "react-native-screens";

import { getTokens, Sheet, View } from "tamagui";

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
  return (
    <RequestCloseContext value={dismissible ? onClose : undefined}>
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
        {...(Platform.OS === "web" ? {} : { containerComponent: SheetWindow, portalProps: { passThrough: true } })}
      >
        <Sheet.Overlay backgroundColor="#00000090" transition="default" opacity="1 enter:0 exit:0" />
        <Sheet.Container className={Platform.OS === "web" ? "sheet-frame" : undefined}>
          <Sheet.Background top="50%" backgroundColor={backgroundColor} />
          <SheetContext value>{children}</SheetContext>
          {!scrollsUnderInset && <Inset />}
        </Sheet.Container>
      </Sheet>
    </RequestCloseContext>
  );
}

const RequestCloseContext = createContext<(() => void) | undefined>(undefined);

function SheetWindow({ children }: { children: React.ReactNode }) {
  const content = <GestureHandlerRootView collapsable={false}>{children}</GestureHandlerRootView>;
  if (Platform.OS === "ios") {
    return <FullWindowOverlay>{content}</FullWindowOverlay>;
  }
  return <SheetDialog>{content}</SheetDialog>;
}

function SheetDialog({ children }: { children: React.ReactNode }) {
  const requestClose = use(RequestCloseContext);
  useLayoutEffect(() => {
    Keyboard.dismiss();
    return () => Keyboard.dismiss();
  }, []);
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={requestClose}
    >
      {children}
    </Modal>
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
  const [height, setHeight] = useState(() => (Platform.OS === "web" ? 0 : (Keyboard.metrics()?.height ?? 0)));
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
