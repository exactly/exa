import React, { createContext, use, useEffect, useState, useSyncExternalStore } from "react";
import { Modal, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

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
  const nested = use(NestedContext);
  const busy = useSyncExternalStore(subscribe, isPresenting, isPresenting);
  const [visible, setVisible] = useState(false);
  if (open && !visible && (nested || !busy)) setVisible(true);
  useEffect(() => {
    if (nested || !visible) return;
    presenting += 1;
    notify();
    return () => {
      presenting -= 1;
      notify();
    };
  }, [nested, visible]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => {
        if (dismissible) onClose();
      }}
    >
      <NestedContext value>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <Sheet
            open={open && visible}
            dismissOnSnapToBottom={dismissible}
            unmountChildrenWhenHidden
            disableRemoveScroll={!open}
            transition="default"
            dismissOnOverlayPress={dismissible}
            onOpenChange={(isOpen: boolean) => {
              if (!isOpen) onClose();
            }}
            onAnimationComplete={({ open: opened }) => {
              if (!opened) setVisible(false);
            }}
            snapPoints={heightPercent ? [heightPercent] : undefined}
            snapPointsMode={heightPercent ? "percent" : "fit"}
            disableDrag={disableDrag}
          >
            <Sheet.Overlay
              backgroundColor="#00000090"
              transition="default"
              enterStyle={{ opacity: 0 }}
              exitStyle={{ opacity: 0 }}
            />
            <Sheet.Frame className={Platform.OS === "web" ? "sheet-frame" : undefined}>{children}</Sheet.Frame>
          </Sheet>
        </GestureHandlerRootView>
      </NestedContext>
    </Modal>
  );
}

// ios presents one modal per view controller: a sheet that opens while another top-level sheet is still on screen
// waits for it to finish closing. sheets opened from inside another sheet render inside it and present on top.
const NestedContext = createContext(false);
const listeners = new Set<() => void>();
let presenting = 0;

function isPresenting() {
  return presenting > 0;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
