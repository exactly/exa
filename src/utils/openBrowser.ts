import { openBrowserAsync } from "expo-web-browser";

import { sdk } from "@farcaster/miniapp-sdk";

export default async function openBrowser(url: string) {
  await ((await sdk.isInMiniApp())
    ? sdk.actions.openUrl(url)
    : openBrowserAsync(url, { windowFeatures: { status: true, menubar: true } }));
}
