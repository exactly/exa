import { Linking } from "react-native";

import { openBrowserAsync } from "expo-web-browser";

import { sdk } from "@farcaster/miniapp-sdk";

export default async function openBrowser(url: string, { external = false } = {}) {
  if (await sdk.isInMiniApp()) return sdk.actions.openUrl(url);
  await (external ? Linking.openURL(url) : openBrowserAsync(url, { windowFeatures: { status: true, menubar: true } }));
}
