import { marketUSDCAddress } from "@exactly/common/generated/chain";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Sheet } from "tamagui";
import { nonEmpty, pipe, safeParse, string } from "valibot";

import PaymentSheetContent from "./PaymentSheetContent";
import RolloverIntro from "./RolloverIntro";
import useAsset from "../../utils/useAsset";

export default function PaymentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [rolloverIntroOpen, setRolloverIntroOpen] = useState(false);
  const { market: USDCMarket } = useAsset(marketUSDCAddress);
  const { maturity: currentMaturity } = useLocalSearchParams();
  const { success, output: maturity } = safeParse(pipe(string(), nonEmpty("no maturity")), currentMaturity);

  if (!success || !USDCMarket) return;
  const { fixedBorrowPositions } = USDCMarket;
  const borrow = fixedBorrowPositions.find((b) => b.maturity === BigInt(maturity));
  if (!borrow) return;

  return (
    <Sheet
      open={open}
      dismissOnSnapToBottom
      unmountChildrenWhenHidden
      forceRemoveScrollEnabled={open}
      animation="moderate"
      dismissOnOverlayPress
      onOpenChange={onClose}
      snapPointsMode="fit"
      zIndex={100_000}
      modal
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Handle />
      <Sheet.Frame>
        {rolloverIntroOpen ? (
          <RolloverIntro
            onClose={() => {
              setRolloverIntroOpen(false);
              onClose();
            }}
          />
        ) : (
          <PaymentSheetContent
            onClose={(displayIntro?: boolean) => {
              setRolloverIntroOpen(displayIntro ?? false);
              onClose();
            }}
          />
        )}
      </Sheet.Frame>
    </Sheet>
  );
}
