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

export function clearWalletExtensionStorage() {
  return native?.clearWalletExtensionStorage() ?? Promise.resolve();
}

export function saveWalletExtensionToken({ token, expire }: { expire: number; token: string }) {
  return native?.saveWalletExtensionToken(token, expire) ?? Promise.resolve();
}

export function saveCardProvisioningSnapshot(snapshot: CardProvisioningSnapshot) {
  return native?.saveCardProvisioningSnapshot(snapshot) ?? Promise.resolve();
}

export function getWalletExtensionToken() {
  return native?.getWalletExtensionToken() ?? Promise.resolve(null);
}

export function getCardProvisioningSnapshot() {
  return native?.getCardProvisioningSnapshot() ?? Promise.resolve(null);
}
