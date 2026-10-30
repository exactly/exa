import React from "react";

import AssetSelector from "../shared/AssetSelector";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

import type { Address } from "@exactly/common/validation";

export default function AssetSelectionSheet({
  open,
  onClose,
  onAssetSelected,
}: {
  onAssetSelected: (market: Address, external: boolean) => void;
  onClose: () => void;
  open: boolean;
}) {
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} borderTopLeftRadius="r4" borderTopRightRadius="r4" fullScreen>
        <View padded paddingTop="s6" flex={1} fullScreen>
          <AssetSelector
            sortBy="usdcFirst"
            onSubmit={(market, isExternalAsset) => {
              onAssetSelected(market, isExternalAsset);
              onClose();
            }}
          />
        </View>
      </SafeView>
    </ModalSheet>
  );
}
