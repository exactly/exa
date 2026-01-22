import React, { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { Sheet } from "tamagui";

import { closeHandlers } from "../../utils/modals";

const ModalSheet = function ({
  open,
  onClose,
  children,
  heightPercent,
  disableDrag = true,
  unmanaged = false,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  heightPercent?: number;
  disableDrag?: boolean;
  unmanaged?: boolean;
}) {
  const reference = useRef(onClose);
  reference.current = onClose;

  useEffect(() => {
    if (!open || unmanaged || Platform.OS === "web") return;
    const handler = () => reference.current();
    closeHandlers.add(handler);
    return () => {
      closeHandlers.delete(handler);
    };
  }, [open, unmanaged]);

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
      portalProps={Platform.OS === "web" ? { className: "sheet-portal" } : undefined}
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
