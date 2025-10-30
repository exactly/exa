import "dotenv/config";

import type { IntercomPluginProps } from "@intercom/intercom-react-native/lib/typescript/expo-plugins/@types";
import type { withSentry } from "@sentry/react-native/expo";
import type { ExpoConfig } from "expo/config";
import type { PluginConfigType as BuildPropertiesConfig } from "expo-build-properties/build/pluginConfig";
import type withCamera from "expo-camera/plugin/build/withCamera";
import type { FontProps } from "expo-font/plugin/build/withFonts";
import type * as OneSignalPlugin from "onesignal-expo-plugin/types/types";

import metadata from "./package.json";
import versionCode from "./src/generated/versionCode.js";

const { Mode } = require("onesignal-expo-plugin/build/types/types") as typeof OneSignalPlugin; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module

if (process.env.APP_DOMAIN) process.env.EXPO_PUBLIC_DOMAIN ??= process.env.APP_DOMAIN;
if (process.env.EAS_BUILD_RUNNER === "eas-build") process.env.EXPO_PUBLIC_DOMAIN ??= "web.exactly.app";
process.env.EXPO_PUBLIC_INTERCOM_APP_ID ??= "eknd6y0s"; // cspell:ignore eknd6y0s

export default {
  name: "Exa",
  slug: "exactly",
  scheme: "exactly",
  version: metadata.version,
  orientation: "portrait",
  newArchEnabled: false,
  android: {
    package: "app.exactly",
    adaptiveIcon: { foregroundImage: "src/assets/icon-adaptive.png", backgroundColor: "#1D1D1D" },
    permissions: ["android.permission.CAMERA"],
    userInterfaceStyle: "automatic",
    versionCode,
    splash: {
      backgroundColor: "#FCFCFC",
      image: "src/assets/splash.png",
      mdpi: "src/assets/splash.png",
      hdpi: "src/assets/splash@1.5x.png",
      xhdpi: "src/assets/splash@2x.png",
      xxhdpi: "src/assets/splash@3x.png",
      xxxhdpi: "src/assets/splash@4x.png",
      dark: {
        backgroundColor: "#1D1D1D",
        image: "src/assets/splash-dark.png",
        mdpi: "src/assets/splash-dark.png",
        hdpi: "src/assets/splash-dark@1.5x.png",
        xhdpi: "src/assets/splash-dark@2x.png",
        xxhdpi: "src/assets/splash-dark@3x.png",
        xxxhdpi: "src/assets/splash-dark@4x.png",
      },
    },
  },
  ios: {
    icon: "src/assets/icon.png",
    bundleIdentifier: "app.exactly",
    associatedDomains: [`webcredentials:${process.env.EXPO_PUBLIC_DOMAIN ?? "sandbox.exactly.app"}`],
    supportsTablet: false,
    buildNumber: String(versionCode),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: "This app uses the camera to verify your identity.",
      NSLocationWhenInUseUsageDescription: "This app uses your location to verify your identity.",
      LSApplicationQueriesSchemes: ["metamask", "trust", "safe", "rainbow", "uniswap", "binance", "base", "rabby"], // cspell:ignore rabby
    },
    userInterfaceStyle: "automatic",
    splash: {
      backgroundColor: "#FCFCFC",
      image: "src/assets/splash.png",
      dark: { backgroundColor: "#1D1D1D", image: "src/assets/splash-dark.png" },
    },
  },
  web: { output: "static", favicon: "src/assets/favicon.png" },
  plugins: [
    [
      "expo-build-properties",
      {
        android: {
          targetSdkVersion: 35,
          packagingOptions: { pickFirst: ["**/libcrypto.so"] },
          extraMavenRepos: ["https://sdk.withpersona.com/android/releases"],
        },
        ios: { deploymentTarget: "15.1" },
      } satisfies BuildPropertiesConfig,
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Exactly needs your permission to scan QR codes.",
      } satisfies Parameters<typeof withCamera>[1],
    ],
    [
      "expo-font",
      {
        fonts: [
          "src/assets/fonts/BDOGrotesk-DemiBold.otf",
          "src/assets/fonts/BDOGrotesk-Regular.otf",
          "src/assets/fonts/IBMPlexMono-Medm.otf",
        ],
      } satisfies FontProps,
    ],
    "expo-router",
    [
      "@intercom/intercom-react-native",
      {
        appId: process.env.EXPO_PUBLIC_INTERCOM_APP_ID,
        androidApiKey: "android_sdk-d602d62cbdb9e8e0a6f426db847ddc74d2e26090",
        iosApiKey: "ios_sdk-ad6831098d9c2d69bd98e92a5ad7a4f030472a92",
      } satisfies IntercomPluginProps,
    ],
    [
      "@sentry/react-native/expo",
      { organization: "exactly", project: "exa" } satisfies Parameters<typeof withSentry>[1],
    ],
    [
      "onesignal-expo-plugin",
      {
        mode: process.env.NODE_ENV === "production" ? Mode.Prod : Mode.Dev,
        smallIcons: ["src/assets/notifications_default.png"],
        largeIcons: ["src/assets/notifications_default_large.png"],
      } satisfies OneSignalPlugin.OneSignalPluginProps,
    ],
    "./src/android.js",
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: "06bc0158-d23b-430b-a7e8-802df03c450b" } },
  updates: { url: "https://u.expo.dev/06bc0158-d23b-430b-a7e8-802df03c450b" },
  runtimeVersion: { policy: "fingerprint" },
  owner: "exactly",
} satisfies ExpoConfig;
