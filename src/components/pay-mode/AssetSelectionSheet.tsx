import type { Address } from "@exactly/common/validation";
import React from "react";
import { Platform } from "react-native";
import { Sheet } from "tamagui";

import useAspectRatio from "../../utils/useAspectRatio";
import AssetSelector from "../shared/AssetSelector";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

export default function AssetSelectionSheet({
  open,
  onClose,
  onAssetSelected,
  positions,
}: {
  open: boolean;
  onClose: () => void;
  onAssetSelected: (market: Address, external: boolean) => void;
  positions?: {
    symbol: string;
    assetName: string;
    floatingDepositAssets: bigint;
    decimals: number;
    usdValue: bigint;
    market: string;
  }[];
}) {
  const aspectRatio = useAspectRatio();
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
      portalProps={Platform.OS === "web" ? { style: { aspectRatio, justifySelf: "center" } } : undefined}
    >
      <Sheet.Overlay
        backgroundColor="#00000090"
        animation="quicker"
        enterStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
        exitStyle={{ opacity: 0 }} // eslint-disable-line react-native/no-inline-styles
      />
      <Sheet.Frame>
        <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
          <View padded paddingTop="$s6" fullScreen flex={1}>
            <AssetSelector
              positions={positions}
              onSubmit={(market, isExternalAsset) => {
                onAssetSelected(market, isExternalAsset);
                onClose();
              }}
            />
          </View>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
