import React from "react";
import { Platform } from "react-native";

import { Sheet } from "tamagui";

export default function ModalSheet({
  open,
  onClose,
  children,
  heightPercent,
  disableDrag = true,
}: {
  children: React.ReactNode;
  disableDrag?: boolean;
  heightPercent?: number;
  onClose: () => void;
  open: boolean;
}) {
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={(isOpen: boolean) => {
        if (!isOpen) onClose();
      }}
      snapPoints={heightPercent ? [heightPercent] : undefined}
      snapPointsMode={heightPercent ? "percent" : "fit"}
      zIndex={100_000}
      disableDrag={disableDrag}
      modal
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Frame className={Platform.OS === "web" ? "sheet-frame" : undefined}>{children}</Sheet.Frame>
    </Sheet>
  );
}
