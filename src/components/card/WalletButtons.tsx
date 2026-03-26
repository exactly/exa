import React from "react";
import { Pressable } from "react-native";

import { Spinner, XStack } from "tamagui";

import MeaPushProvisioning from "@meawallet/react-native-mpp";

import useWalletProvisioning from "./useWalletProvisioning";
import GoogleWalletButton from "../../assets/images/google-wallet-button.svg";

export default function WalletButtons({ lastFour, displayName }: { displayName: string; lastFour: string }) {
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
            hitSlop={8}
            onPress={() => {
              addToGoogleWallet().catch(() => undefined);
            }}
          >
            <GoogleWalletButton width={200} height={48} />
          </Pressable>
        ))}
    </XStack>
  );
}
