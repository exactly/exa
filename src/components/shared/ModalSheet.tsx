import React from "react";
import { Platform } from "react-native";
import { Sheet, Stack } from "tamagui";

const WebSheetPortalContainer = function ({ children }: { children: React.ReactNode }) {
  return <Stack className="sheet-portal">{children}</Stack>;
};

const ModalSheet = function ({
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
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>{children}</Sheet.Frame>
    </Sheet>
  );
};

export default ModalSheet;
