import { sdk } from "@farcaster/miniapp-sdk";
import { openBrowserAsync } from "expo-web-browser";

export default function useOpenBrowser() {
  return async (url: string) => {
    await ((await sdk.isInMiniApp()) ? sdk.actions.openUrl(url) : openBrowserAsync(url));
  };
}
