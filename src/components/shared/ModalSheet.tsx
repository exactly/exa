import React, { useEffect, useState } from "react";
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
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    const timeout = setTimeout(() => {
      setMounted(false);
    }, exitDuration);
    return () => {
      clearTimeout(timeout);
    };
  }, [open]);
  if (!mounted) return null; // HACK ios 26 reads the empty portal wrapper of a closed sheet as modal and hides the whole a11y tree
  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom={dismissible}
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
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
      <Sheet.Overlay
        backgroundColor="#00000090"
        transition="default"
        enterStyle={{ opacity: 0 }}
        exitStyle={{ opacity: 0 }}
      />
      <Sheet.Frame className={Platform.OS === "web" ? "sheet-frame" : undefined}>{children}</Sheet.Frame>
    </Sheet>
  );
}

const exitDuration = 400; // TODO replace with onAnimationComplete after upgrading @tamagui/sheet to 2.x
