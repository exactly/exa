import "@walletconnect/react-native-compat";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAppKit } from "@reown/appkit-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";

import { supportedChains } from "./wagmi/external";

const projectId = "YOUR_PROJECT_ID"; // Obtain from https://dashboard.reown.com/

export const wagmiAdapter = new WagmiAdapter({ projectId, networks: supportedChains });

export default createAppKit({
  projectId,
  networks: [...supportedChains],
  adapters: [wagmiAdapter],
  metadata: {
    name: "Exa App",
    description: "What finance should be today",
    url: "https://web.exactly.app",
    icons: ["https://exactly.app/og-image.webp"], // TODO replace with actual icon
  },
  storage: {
    getKeys: async () => {
      return (await AsyncStorage.getAllKeys()) as string[];
    },
    getEntries: async <T = unknown>(): Promise<[string, T][]> => {
      const keys = await AsyncStorage.getAllKeys();
      return await Promise.all(
        keys.map(async (key) => [key, JSON.parse((await AsyncStorage.getItem(key)) ?? "") as T]),
      );
    },
    setItem: async (key: string, value: unknown) => {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    },
    getItem: async <T = unknown>(key: string): Promise<T | undefined> => {
      const item = await AsyncStorage.getItem(key);
      if (item === null) return undefined;
      return JSON.parse(item) as T;
    },
    removeItem: async (key: string) => {
      await AsyncStorage.removeItem(key);
    },
  },
});
