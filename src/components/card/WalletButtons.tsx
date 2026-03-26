import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { Spinner, XStack } from "tamagui";

import MeaPushProvisioning from "@meawallet/react-native-mpp";

import useWalletProvisioning from "./useWalletProvisioning";
import Text from "../shared/Text";

export default function WalletButtons({ lastFour, displayName }: { displayName: string; lastFour: string }) {
  const { t } = useTranslation();
  const { eligible, provisioning, isPending, addToAppleWallet, addToGoogleWallet } = useWalletProvisioning(
    lastFour,
    displayName,
  );

  if (isPending || (!eligible?.apple && !eligible?.google)) return null;

  return (
    <XStack alignSelf="center" alignItems="center" justifyContent="center">
      {eligible.apple &&
        (provisioning ? (
          <Spinner color="$interactiveTextBrandDefault" />
        ) : (
          <MeaPushProvisioning.ApplePay.AddPassButton
            style={{ height: 44, width: 200 }}
            addPassButtonStyle="black"
            onPress={() => {
              addToAppleWallet().catch(() => undefined);
            }}
          />
        ))}
      {eligible.google &&
        (provisioning ? (
          <Spinner color="$interactiveTextBrandDefault" />
        ) : (
          <Pressable
            hitSlop={20}
            onPress={() => {
              addToGoogleWallet().catch(() => undefined);
            }}
          >
            <Text emphasized footnote color="$interactiveTextBrandDefault">
              {t("Add to Google Wallet")}
            </Text>
          </Pressable>
        ))}
    </XStack>
  );
}
