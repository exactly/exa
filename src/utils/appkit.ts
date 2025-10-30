import "@walletconnect/react-native-compat";

import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAppKit } from "@reown/appkit-react-native";
import { WagmiAdapter } from "@reown/appkit-wagmi-react-native";
import { setStringAsync } from "expo-clipboard";
import { deserialize, serialize } from "wagmi";

import { supportedChains, projectId } from "./wagmi/external";

const wagmiAdapter = new WagmiAdapter({ projectId, networks: supportedChains });
export const appKitWagmiConfig = wagmiAdapter.wagmiConfig;

export default createAppKit({
  projectId,
  networks: [...supportedChains],
  adapters: [wagmiAdapter],
  defaultNetwork: chain,
  features: { onramp: false, socials: false, swaps: false, showWallets: false },
  clipboardClient: {
    setString: async (value: string) => {
      await setStringAsync(value);
    },
  },
  metadata: {
    name: "Exa App",
    description: "What finance should be today",
    url: `https://${domain}`,
    icons: [`https://${domain}/assets/src/assets/icon.398a7d94ad4f3fdc1e745ea39378674a.png`],
  },
  storage: {
    getKeys: async () => {
      return (await AsyncStorage.getAllKeys()) as string[];
    },
    getEntries: async <T = unknown>(): Promise<[string, T][]> => {
      const keys = await AsyncStorage.getAllKeys();
      return await Promise.all(keys.map(async (key) => [key, deserialize<T>((await AsyncStorage.getItem(key)) ?? "")]));
    },
    setItem: async (key: string, value: unknown) => {
      await AsyncStorage.setItem(key, serialize(value));
    },
    getItem: async <T = unknown>(key: string): Promise<T | undefined> => {
      const item = await AsyncStorage.getItem(key);
      if (item === null) return undefined;
      return deserialize<T>(item);
    },
    removeItem: async (key: string) => {
      await AsyncStorage.removeItem(key);
    },
  },
});
