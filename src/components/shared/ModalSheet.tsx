import React from "react";
import { Platform } from "react-native";

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
    >
      <Sheet.Overlay backgroundColor="#00000090" transition="default" opacity="1 enter:0 exit:0" />
      <Sheet.Container className={Platform.OS === "web" ? "sheet-frame" : undefined}>
        <Sheet.Background />
        {children}
      </Sheet.Container>
    </Sheet>
  );
}
