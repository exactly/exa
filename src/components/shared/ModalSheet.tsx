import React from "react";
import { Platform } from "react-native";
import { Sheet, Stack } from "tamagui";

function WebSheetPortalContainer({ children }: { children: React.ReactNode }) {
  return <Stack className="sheet-portal">{children}</Stack>;
}

export default function ModalSheet({
  open,
  onClose,
  children,
  heightPercent,
  disableDrag = true,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  heightPercent?: number;
  disableDrag?: boolean;
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
      containerComponent={Platform.OS === "web" ? WebSheetPortalContainer : React.Fragment}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Frame>{children}</Sheet.Frame>
    </Sheet>
  );
}
