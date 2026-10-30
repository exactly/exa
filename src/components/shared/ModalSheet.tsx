import React, { createContext, use, useLayoutEffect } from "react";
import { Keyboard, Modal, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { FullWindowOverlay } from "react-native-screens";

import { Sheet } from "tamagui";

export default function ModalSheet({
  open,
  onClose,
  children,
  heightPercent,
  disableDrag = true,
  dismissible = true,
}: {
  children: React.ReactNode;
  disableDrag?: boolean;
  dismissible?: boolean;
  heightPercent?: number;
  onClose: () => void;
  open: boolean;
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
        modal
        {...(Platform.OS === "web" ? {} : { containerComponent: SheetWindow, portalProps: { passThrough: true } })}
      >
        <Sheet.Overlay backgroundColor="#00000090" transition="default" opacity="1 enter:0 exit:0" />
        <Sheet.Container className={Platform.OS === "web" ? "sheet-frame" : undefined}>
          <Sheet.Background />
          {children}
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
