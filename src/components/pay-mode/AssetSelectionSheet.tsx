import type { Address } from "@exactly/common/validation";
import { Coins } from "@tamagui/lucide-icons";
import React from "react";
import { Platform } from "react-native";
import { Sheet } from "tamagui";

import useAspectRatio from "../../utils/useAspectRatio";
import AssetSelector from "../shared/AssetSelector";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

export default function AssetSelectionSheet({
  open,
  onClose,
  onAssetSelected,
  positions,
  symbol,
  disabled,
}: {
  open: boolean;
  onClose: () => void;
  onAssetSelected: (market: Address, isExternalAsset: boolean) => void;
  symbol?: string;
  positions?: {
    symbol: string;
    assetName: string;
    floatingDepositAssets: bigint;
    decimals: number;
    usdValue: bigint;
    market: string;
  }[];
  disabled?: boolean;
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
            <>
              <View gap="$s5">
                <AssetSelector positions={positions} onSubmit={onAssetSelected} />
                <View>
                  <Button
                    onPress={onClose}
                    contained
                    main
                    spaced
                    fullwidth
                    iconAfter={
                      <Coins
                        strokeWidth={2.5}
                        color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
                      />
                    }
                  >
                    {symbol ? `Pay with ${symbol}` : "Select an asset"}
                  </Button>
                </View>
              </View>
            </>
          </View>
        </SafeView>
      </Sheet.Frame>
    </Sheet>
  );
}
