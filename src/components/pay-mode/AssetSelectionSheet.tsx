import type { Address } from "@exactly/common/validation";
import React from "react";

import AssetSelector from "../shared/AssetSelector";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

export default function AssetSelectionSheet({
  open,
  onClose,
  onAssetSelected,
}: {
  open: boolean;
  onClose: () => void;
  onAssetSelected: (market: Address, external: boolean) => void;
}) {
  return (
    <ModalSheet open={open} onClose={onClose}>
      <SafeView paddingTop={0} fullScreen borderTopLeftRadius="$r4" borderTopRightRadius="$r4">
        <View padded paddingTop="$s6" fullScreen flex={1}>
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
