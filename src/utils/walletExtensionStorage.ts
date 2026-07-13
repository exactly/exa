import { NativeModules } from "react-native";

type CardProvisioningSnapshot = {
  displayName: string;
  expirationMonth: string;
  expirationYear: string;
  lastFour: string;
  productId: string;
};

declare module "react-native/Libraries/BatchedBridge/NativeModules" {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface NativeModulesStatic {
    WalletExtensionStorage?: {
      clearWalletExtensionStorage(): Promise<void>;
      getCardProvisioningSnapshot(): Promise<CardProvisioningSnapshot | null>;
      getWalletExtensionToken(): Promise<null | { expire: number; token: string }>;
      saveCardProvisioningSnapshot(snapshot: CardProvisioningSnapshot): Promise<void>;
      saveWalletExtensionToken(token: string, expire: number): Promise<void>;
    };
  }
}

const native = NativeModules.WalletExtensionStorage;

export function clear() {
  return native?.clearWalletExtensionStorage() ?? Promise.resolve();
}

export function saveToken(token: string, expire: number) {
  return native?.saveWalletExtensionToken(token, expire) ?? Promise.resolve();
}

export function saveSnapshot(snapshot: CardProvisioningSnapshot) {
  return native?.saveCardProvisioningSnapshot(snapshot) ?? Promise.resolve();
}

export function getToken() {
  return native?.getWalletExtensionToken() ?? Promise.resolve(null);
}

export function getSnapshot() {
  return native?.getCardProvisioningSnapshot() ?? Promise.resolve(null);
}
