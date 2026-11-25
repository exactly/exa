import { Linking, Platform } from "react-native";

import { openBrowserAsync } from "expo-web-browser";

import { sdk } from "@farcaster/miniapp-sdk";

import { cover } from "./update";

export default async function openBrowser(url: string, { external = false } = {}) {
  if (await sdk.isInMiniApp()) return sdk.actions.openUrl(url);
  if (external) {
    await Linking.openURL(url);
    return;
  }
  const uncover = cover({ native: true });
  try {
    await openBrowserAsync(url, { windowFeatures: { status: true, menubar: true } });
  } catch (error: unknown) {
    uncover();
    throw error;
  }
  if (Platform.OS !== "android") uncover();
}
