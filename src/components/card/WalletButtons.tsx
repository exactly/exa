import React from "react";
import { Pressable } from "react-native";

import { Spinner, XStack } from "tamagui";

import MeaPushProvisioning from "@meawallet/react-native-mpp";

import useWalletProvisioning from "./useWalletProvisioning";
import GoogleWalletButton from "../../assets/images/google-wallet-button.svg";

export default function WalletButtons({ displayName, lastFour }: { displayName: string; lastFour: string }) {
  const { eligible, provisioning, isPending, addToAppleWallet, addToGoogleWallet } = useWalletProvisioning(
    lastFour,
    displayName,
  );

  if (isPending || (!eligible?.apple && !eligible?.google)) return null;

  return (
    <XStack alignSelf="center" alignItems="center" justifyContent="center">
      {provisioning ? (
        <Spinner color="$interactiveTextBrandDefault" />
      ) : (
        <>
          {eligible.apple && (
            <MeaPushProvisioning.ApplePay.AddPassButton
              style={{ height: 44, width: 200 }}
              addPassButtonStyle="black"
              onPress={() => {
                addToAppleWallet().catch(() => undefined);
              }}
            />
          )}
          {eligible.google && (
            <Pressable
              accessibilityLabel="add to google wallet"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                addToGoogleWallet().catch(() => undefined);
              }}
            >
              <GoogleWalletButton width={200} height={48} />
            </Pressable>
          )}
        </>
      )}
    </XStack>
  );
}
