import { useSafeAreaInsets } from "react-native-safe-area-context"; // eslint-disable-line no-restricted-imports -- single entry point for insets

import { sdk } from "@farcaster/miniapp-sdk";
import { useQuery } from "@tanstack/react-query";

import reportError from "./reportError";

export default function useInsets() {
  const device = useSafeAreaInsets();
  const { data: isMiniApp } = useQuery({ queryKey: ["is-miniapp"] });
  const { data: miniApp } = useQuery({
    queryKey: ["miniapp-insets"],
    queryFn: async () => {
      try {
        const { client } = await sdk.context;
        return client.safeAreaInsets ?? null;
      } catch (error) {
        reportError(error);
        return null;
      }
    },
    enabled: !!isMiniApp,
    staleTime: Infinity,
    retry: false,
  });
  return isMiniApp && miniApp ? miniApp : device;
}
