import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Headphones } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import { formatUnits } from "viem";

import { newMessage, present } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import Button from "../shared/Button";
import ModalSheet from "../shared/ModalSheet";
import Text from "../shared/Text";

import type { ExternalAsset } from "../../utils/usePortfolio";

export default function UnsupportedNetworksSheet({
  asset,
  chainName,
  onClose,
  open,
}: {
  asset?: ExternalAsset;
  chainName?: string;
  onClose: () => void;
  open: boolean;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const pendingMessageRef = useRef<null | string>(null);
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <YStack
        gap="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s5" paddingTop="$s7" paddingHorizontal="$s5">
          <Text emphasized headline>
            {t("Non-supported network")}
          </Text>
          <YStack gap="$s4">
            <Text subHeadline color="$uiNeutralSecondary">
              {t(
                "This network isn't supported yet, so assets on it can't be recovered through the app for now. We're continuously working to add support for more networks, and this one may be supported in the future.",
              )}
            </Text>
            <Text subHeadline color="$uiNeutralSecondary">
              {t("You can contact us to share feedback and help us prioritize which networks to support next.")}
            </Text>
          </YStack>
        </YStack>
        <YStack paddingHorizontal="$s5" paddingBottom="$s7">
          <Button
            onPress={() => {
              pendingMessageRef.current =
                asset && chainName
                  ? t(
                      "Hi! I'd like help recovering an asset on a network that isn't supported yet.\n\nNetwork: {{chainName}} (chain ID {{chainId}})\nAsset: {{symbol}}\nToken address: {{address}}\nAmount: {{amount}} {{symbol}}\nCurrent value: ${{usdValue}}",
                      {
                        chainName,
                        chainId: asset.chainId,
                        symbol: asset.symbol,
                        address: asset.address,
                        amount: Number(formatUnits(asset.amount ?? 0n, asset.decimals)).toLocaleString(language, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: Math.min(6, asset.decimals),
                        }),
                        usdValue: asset.usdValue.toLocaleString(language, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }),
                      },
                    )
                  : "";
              onClose();
            }}
            contained
            main
            spaced
            fullwidth
            iconAfter={<Headphones strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />}
          >
            {t("Contact support")}
          </Button>
        </YStack>
      </YStack>
      <PresentSupportOnHide pendingMessage={pendingMessageRef} />
    </ModalSheet>
  );
}

function PresentSupportOnHide({ pendingMessage }: { pendingMessage: { current: null | string } }) {
  useEffect(() => {
    return () => {
      const message = pendingMessage.current;
      if (message === null) return;
      pendingMessage.current = null;
      (message.length > 0 ? newMessage(message) : present()).catch(reportError);
    };
  }, [pendingMessage]);
  return null;
}
