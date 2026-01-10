import type { IntercomPluginProps } from "@intercom/intercom-react-native/lib/typescript/module/expo-plugins/@types";
import type { withSentry } from "@sentry/react-native/expo";
import type { ExpoConfig } from "expo/config";
import { AndroidConfig, type ConfigPlugin, withAndroidManifest } from "expo/config-plugins";
import type { PluginConfigType as BuildPropertiesConfig } from "expo-build-properties/build/pluginConfig";
import type withCamera from "expo-camera/plugin/build/withCamera";
import type { FontProps } from "expo-font/plugin/build/withFonts";
import { env } from "node:process";
import type * as OneSignalPlugin from "onesignal-expo-plugin/types/types";

import metadata from "./package.json";
import versionCode from "./src/generated/versionCode.js";

const { Mode } = require("onesignal-expo-plugin/build/types/types") as typeof OneSignalPlugin; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module

if (env.EAS_BUILD_RUNNER === "eas-build") env.APP_DOMAIN ??= "web.exactly.app";
if (env.APP_DOMAIN) env.EXPO_PUBLIC_DOMAIN = env.APP_DOMAIN;
env.EXPO_PUBLIC_INTERCOM_APP_ID ??= "eknd6y0s"; // cspell:ignore eknd6y0s

export default {
  name: "Exa",
  slug: "exactly",
  scheme: "exactly",
  version: metadata.version,
  orientation: "portrait",
  android: {
    package: "app.exactly",
    adaptiveIcon: { foregroundImage: "src/assets/icon-adaptive.png", backgroundColor: "#1D1D1D" },
    permissions: ["android.permission.CAMERA"],
    userInterfaceStyle: "automatic",
    edgeToEdgeEnabled: true,
    versionCode,
    splash: {
      backgroundColor: "#FCFCFC",
      image: "src/assets/splash.png",
      resizeMode: "contain",
      dark: { backgroundColor: "#1D1D1D", image: "src/assets/splash-dark.png" },
    },
  },
  ios: {
    icon: "src/assets/icon.png",
    bundleIdentifier: "app.exactly",
    associatedDomains: [`webcredentials:${env.APP_DOMAIN ?? "sandbox.exactly.app"}`],
    supportsTablet: false,
    buildNumber: String(versionCode),
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: "This app uses the camera to verify your identity.",
      NSLocationWhenInUseUsageDescription: "This app uses your location to verify your identity.",
    },
    userInterfaceStyle: "automatic",
    splash: {
      backgroundColor: "#FCFCFC",
      image: "src/assets/splash.png",
      resizeMode: "contain",
      dark: { backgroundColor: "#1D1D1D", image: "src/assets/splash-dark.png" },
    },
  },
  web: { output: "static", favicon: "src/assets/favicon.png" },
  plugins: [
    [
      "expo-build-properties",
      {
        android: {
          packagingOptions: { pickFirst: ["**/libcrypto.so"] },
          extraMavenRepos: ["https://sdk.withpersona.com/android/releases"],
          usesCleartextTraffic: env.APP_DOMAIN === "localhost",
        },
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
    "expo-asset",
    "expo-router",
    [
      "@intercom/intercom-react-native",
      {
        appId: env.EXPO_PUBLIC_INTERCOM_APP_ID,
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
        mode: env.NODE_ENV === "production" ? Mode.Prod : Mode.Dev,
        smallIcons: ["src/assets/notifications_default.png"],
        largeIcons: ["src/assets/notifications_default_large.png"],
      } satisfies OneSignalPlugin.OneSignalPluginProps,
    ],
    // @ts-expect-error inline plugin
    ((config) =>
      withAndroidManifest(config, (configWithManifest) => {
        const manifest = configWithManifest.modResults;
        manifest.manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
        const mainApplication = AndroidConfig.Manifest.getMainApplication(manifest);
        if (!mainApplication) return configWithManifest;
        const META_NAME = "com.google.mlkit.vision.DEPENDENCIES"; // cspell:ignore mlkit
        mainApplication["meta-data"] =
          mainApplication["meta-data"]?.filter(({ $ }) => $["android:name"] !== META_NAME) ?? [];
        mainApplication["meta-data"].push({
          $: {
            "android:name": META_NAME,
            "android:value": "ocr,face,barcode,barcode_ui",
            // @ts-expect-error xmlns:tools
            "tools:replace": "android:value",
          },
        });
        configWithManifest.modResults = manifest;
        return configWithManifest;
      })) satisfies ConfigPlugin,
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: "06bc0158-d23b-430b-a7e8-802df03c450b" } },
  updates: { url: "https://u.expo.dev/06bc0158-d23b-430b-a7e8-802df03c450b" },
  runtimeVersion: { policy: "fingerprint" },
  owner: "exactly",
} satisfies ExpoConfig;
