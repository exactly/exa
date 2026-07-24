import { Platform } from "react-native";

import type * as MeaWallet from "@meawallet/react-native-mpp";

export type MeaWalletModule = typeof MeaWallet;

let walletInitPromise: Promise<MeaWalletModule> | undefined;

export default function init() {
  if (Platform.OS === "web") return Promise.reject(new Error("wallet unavailable on web"));
  walletInitPromise ??= import("@meawallet/react-native-mpp")
    .then(async (wallet) => {
      await wallet.default.initialize();
      return wallet;
    })
    .catch((error: unknown) => {
      walletInitPromise = undefined;
      throw error;
    });
  return walletInitPromise;
}
