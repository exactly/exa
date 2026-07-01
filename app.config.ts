import type { PluginConfigType as BuildPropertiesConfig } from "expo-build-properties/build/pluginConfig";
import type { FontProps } from "expo-font/plugin/build/withFonts";

import { withXcodeProjectBeta } from "@bacons/apple-targets/build/with-bacons-xcode";
import { PBXFileReference, PBXNativeTarget, PBXShellScriptBuildPhase } from "@bacons/xcode";
import {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withXcodeProject,
  type ConfigPlugin,
} from "expo/config-plugins";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { env } from "node:process";

import metadata from "./package.json";
import versionCode from "./src/generated/versionCode.js";

import type { IntercomPluginProps } from "@intercom/intercom-react-native/lib/typescript/module/expo-plugins/@types";
import type { withSentry } from "@sentry/react-native/expo";
import type { ExpoConfig } from "expo/config";

// cspell:ignore INFOPLIST IPHONEOS jsbundle SRCROOT UNLOCALIZED OBJC RCTJS RCTUI modulemap fmodule gsub podfile Podfile xcconfig

if (env.EAS_BUILD_RUNNER === "eas-build") env.APP_DOMAIN ??= "web.exactly.app";
if (env.APP_DOMAIN) env.EXPO_PUBLIC_DOMAIN = env.APP_DOMAIN;
env.EXPO_PUBLIC_INTERCOM_APP_ID ??= env.APP_DOMAIN === "web.exactly.app" ? "eknd6y0s" : "pxd0wo85"; // cspell:ignore eknd6y0s

const appGroupIdentifier = "group.app.exactly";
const appleTeamId = "665NDX7LBZ";
const keychainAccessGroup = "$(AppIdentifierPrefix)app.exactly";
const walletExtensionBundleScript = "Bundle React Native Wallet Extension";
const walletExtensionTarget = "ExaWalletExtension";

function copyMeaConfig(projectRoot: string, destination: string, label: string) {
  const source = path.join(projectRoot, "src/assets/mea_config");
  if (!existsSync(source)) throw new Error(`${label}: missing src/assets/mea_config`);
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

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
    entitlements: {
      "com.apple.developer.payment-pass-provisioning": true,
      "com.apple.security.application-groups": [appGroupIdentifier],
      "keychain-access-groups": [keychainAccessGroup],
    },
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
      NSCameraUsageDescription: "Exa uses the camera to scan QR codes and verify your identity.",
      NSLocationWhenInUseUsageDescription: "Exa uses your location to verify your identity.",
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
    // @ts-expect-error inline plugin
    ((config) =>
      withXcodeProject(config, (c) => {
        const project = c.modResults;
        const objects = project.hash.project.objects;
        const targetDependencies = objects.PBXTargetDependency;
        const containerItemProxies = objects.PBXContainerItemProxy;
        if (!targetDependencies && !containerItemProxies) return c;
        const dependencies: NonNullable<typeof objects.PBXTargetDependency> = {};
        const proxies: NonNullable<typeof objects.PBXContainerItemProxy> = {};
        for (const { fallback, section } of [
          { fallback: dependencies, section: targetDependencies },
          { fallback: proxies, section: containerItemProxies },
        ]) {
          if (!section) continue;
          for (const [key, value] of Object.entries(section)) {
            const isa = typeof value === "object" ? value.isa : value;
            (isa === "PBXContainerItemProxy" ? proxies : isa === "PBXTargetDependency" ? dependencies : fallback)[key] =
              value;
          }
        }
        const nativeTargets = objects.PBXNativeTarget ?? {};
        for (const [key, value] of Object.entries(dependencies)) {
          if (!value || typeof value !== "object") continue;
          if (value.isa !== "PBXTargetDependency") continue;
          if (typeof value.target !== "string" || typeof value.targetProxy !== "string") continue;
          if (proxies[value.targetProxy]) continue;
          const nativeTarget = nativeTargets[value.target];
          proxies[value.targetProxy] = {
            isa: "PBXContainerItemProxy",
            containerPortal: project.hash.project.rootObject,
            containerPortal_comment: project.hash.project.rootObject_comment,
            proxyType: 1,
            remoteGlobalIDString: value.target,
            remoteInfo:
              nativeTarget && typeof nativeTarget === "object" && typeof nativeTarget.name === "string"
                ? nativeTarget.name
                : value.target,
          };
          proxies[`${value.targetProxy}_comment`] = "PBXContainerItemProxy";
          dependencies[`${key}_comment`] ??= "PBXTargetDependency";
        }
        objects.PBXTargetDependency = dependencies;
        objects.PBXContainerItemProxy = proxies;
        const removeUndefinedValues = (value: unknown) => {
          if (!value || typeof value !== "object") return;
          if (Array.isArray(value)) {
            for (const item of value) removeUndefinedValues(item);
            return;
          }
          for (const [key, entry] of Object.entries(value)) {
            if (entry === undefined) {
              Reflect.deleteProperty(value, key);
            } else {
              removeUndefinedValues(entry);
            }
          }
        };
        removeUndefinedValues(objects);
        return c;
      })) satisfies ConfigPlugin,
    [
      "expo-build-properties",
      {
        android: {
          packagingOptions: { pickFirst: ["**/libcrypto.so"] },
          extraMavenRepos: [
            "https://sdk.withpersona.com/android/releases",
            {
              url: "https://nexus.ext.meawallet.com/repository/mpp-android-group/",
              credentials: { username: "ext-mpp-android", password: "M1yeJMcuE5TiGW" },
            },
          ],
          usesCleartextTraffic: env.APP_DOMAIN === "localhost",
        },
      } satisfies BuildPropertiesConfig,
    ],
    "expo-camera",
    [
      "expo-font",
      {
        fonts: [
          "src/assets/fonts/SplineSansMono-Medium.otf",
          "src/assets/fonts/SplineSans-Regular.otf",
          "src/assets/fonts/SplineSans-SemiBold.otf",
        ],
      } satisfies FontProps,
    ],
    "expo-asset",
    [
      "expo-localization",
      { supportedLocales: ["en", "es", "es-AR", "es-CR", "es-GT", "es-HN", "es-NI", "es-PY", "es-SV", "es-UY", "pt"] },
    ],
    "expo-router",
    [
      "@intercom/intercom-react-native",
      {
        appId: env.EXPO_PUBLIC_INTERCOM_APP_ID,
        androidApiKey:
          env.APP_DOMAIN === "web.exactly.app"
            ? "android_sdk-d602d62cbdb9e8e0a6f426db847ddc74d2e26090"
            : "android_sdk-e98928bdde6eeb08efe3c1a1f683756b98fc1ba1",
        iosApiKey:
          env.APP_DOMAIN === "web.exactly.app"
            ? "ios_sdk-ad6831098d9c2d69bd98e92a5ad7a4f030472a92"
            : "ios_sdk-53eec69c747965af2ed69c8e0454b381f04feb86",
      } satisfies IntercomPluginProps,
    ],
    [
      "@sentry/react-native/expo",
      { organization: "exactly", project: "exa" } satisfies Parameters<typeof withSentry>[1],
    ],
    [
      "onesignal-expo-plugin",
      {
        mode: env.NODE_ENV === "production" ? "production" : "development",
        smallIcons: ["src/assets/notifications_default.png"],
        largeIcons: ["src/assets/notifications_default_large.png"],
      },
    ],
    // @ts-expect-error inline plugin
    ((config) => {
      const withAndroid = withDangerousMod(config, [
        "android",
        (c) => {
          copyMeaConfig(
            c.modRequest.projectRoot,
            path.join(c.modRequest.projectRoot, "android/app/src/main/res/raw/mea_config"),
            "meawallet",
          );
          return c;
        },
      ]);
      return withXcodeProject(withAndroid, (c) => {
        const projectName = c.modRequest.projectName ?? "";
        const destination = path.join(c.modRequest.projectRoot, "ios", projectName, "mea_config");
        copyMeaConfig(c.modRequest.projectRoot, destination, "meawallet");
        IOSConfig.XcodeUtils.addResourceFileToGroup({
          filepath: `${projectName}/mea_config`,
          groupName: projectName,
          project: c.modResults,
          isBuildFile: true,
        });
        return c;
      });
    }) satisfies ConfigPlugin,
    // @ts-expect-error inline plugin
    ((config) =>
      withXcodeProjectBeta(
        withDangerousMod(config, [
          "ios",
          (c) => {
            const iosRoot = path.join(c.modRequest.projectRoot, "ios");
            const podfile = path.join(iosRoot, "Podfile");
            if (!existsSync(podfile)) return c;
            let contents = readFileSync(podfile, "utf8");
            const walletExtensionStoragePod =
              "  pod 'WalletExtensionStorage', :path => '../modules/wallet-extension-storage/ios'\n";
            if (!contents.includes(`target 'Exa' do\n  use_expo_modules!\n${walletExtensionStoragePod}`)) {
              const nextContents = contents.replace(/(\n\s+use_expo_modules!\n)/, `$1${walletExtensionStoragePod}`);
              if (nextContents === contents)
                throw new Error("wallet extension: failed to inject storage pod into ios/Podfile");
              contents = nextContents;
            }
            writeFileSync(podfile, contents);
            return c;
          },
        ]),
        (c) => {
          const project = c.modResults;
          const target = project.rootObject.props.targets.find(
            (candidate): candidate is PBXNativeTarget =>
              PBXNativeTarget.is(candidate) && candidate.props.name === walletExtensionTarget,
          );
          if (!target) throw new Error(`wallet extension: ${walletExtensionTarget} target was not generated`);
          const meaConfigPath = path.join(c.modRequest.projectRoot, "src/assets/mea_config");
          if (!existsSync(meaConfigPath)) throw new Error("wallet extension: missing src/assets/mea_config");
          let meaConfigReference = project.getReferenceForPath(meaConfigPath);
          if (!meaConfigReference) {
            meaConfigReference = PBXFileReference.create(project, { path: "../src/assets/mea_config" });
            project.rootObject.props.mainGroup.props.children.push(meaConfigReference);
          }
          target.getResourcesBuildPhase().ensureFile({ fileRef: meaConfigReference });
          const bundlePhase = target.props.buildPhases.find(
            (phase): phase is PBXShellScriptBuildPhase =>
              PBXShellScriptBuildPhase.is(phase) && phase.props.name === walletExtensionBundleScript,
          );
          if (bundlePhase) {
            bundlePhase.props.outputPaths = [];
          } else {
            target.createBuildPhase(PBXShellScriptBuildPhase, {
              name: walletExtensionBundleScript,
              inputPaths: ['"$(SRCROOT)/.xcode.env"', '"$(SRCROOT)/.xcode.env.local"'],
              outputPaths: [],
              shellPath: "/bin/sh",
              shellScript: `set -e
if [[ -f "$PODS_ROOT/../.xcode.env" ]]; then
  source "$PODS_ROOT/../.xcode.env"
fi
if [[ -f "$PODS_ROOT/../.xcode.env.local" ]]; then
  source "$PODS_ROOT/../.xcode.env.local"
fi

export NODE_BINARY="\${NODE_BINARY:-node}"
export PROJECT_ROOT="$PROJECT_DIR"/..
export ENTRY_FILE=src/issuerNonUIExtension.ts
export BUNDLE_NAME=main
if [[ -z "$CLI_PATH" ]]; then
  export CLI_PATH="$("$NODE_BINARY" --print "require.resolve('@expo/cli', { paths: [require.resolve('expo/package.json')] })")"
fi
if [[ -z "$BUNDLE_COMMAND" ]]; then
  export BUNDLE_COMMAND="export:embed"
fi
WITH_ENVIRONMENT="$SRCROOT/../node_modules/react-native/scripts/xcode/with-environment.sh"
REACT_NATIVE_XCODE="$SRCROOT/../node_modules/react-native/scripts/react-native-xcode.sh"
/bin/sh -c "$WITH_ENVIRONMENT $REACT_NATIVE_XCODE"`,
            });
          }
          for (const buildConfiguration of target.props.buildConfigurationList.props.buildConfigurations) {
            const buildSettings = buildConfiguration.props.buildSettings;
            Reflect.set(buildSettings, "APPLICATION_EXTENSION_API_ONLY", "YES");
            Reflect.set(buildSettings, "DEFINES_MODULE", "YES");
            buildSettings.GENERATE_INFOPLIST_FILE = "NO";
            buildSettings.TARGETED_DEVICE_FAMILY = "1";
            Reflect.deleteProperty(buildSettings, "CLANG_CXX_LANGUAGE_STANDARD");
            Reflect.deleteProperty(buildSettings, "CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER");
          }
          return c;
        },
      )) satisfies ConfigPlugin,
    ["@bacons/apple-targets/app.plugin", { appleTeamId }],
    // @ts-expect-error inline plugin
    ((config) =>
      withDangerousMod(config, [
        "ios",
        (c) => {
          const podfile = path.join(c.modRequest.projectRoot, "ios/Podfile");
          if (!existsSync(podfile)) return c;
          const contents = readFileSync(podfile, "utf8");
          const updatedContents = injectPodfilePostInstall(
            contents,
            "patchWalletExtensionSwiftCompatibility",
            getWalletExtensionPodfilePatch(),
          );
          if (updatedContents !== contents) writeFileSync(podfile, updatedContents);
          return c;
        },
      ])) satisfies ConfigPlugin,
    // @ts-expect-error inline plugin
    ((config) =>
      withAndroidManifest(
        withAppBuildGradle(config, (c) => {
          c.modResults.contents = c.modResults.contents.replaceAll(
            /(defaultConfig\s*\{)(?:\s*ndk\s*\{\s*debugSymbolLevel\s*"FULL"\s*\})+/g,
            "$1",
          );
          if (!c.modResults.contents.includes('debugSymbolLevel "FULL"')) {
            c.modResults.contents = c.modResults.contents.replace(
              /release\s*\{/,
              '$&\n            ndk { debugSymbolLevel "FULL" }',
            );
          }
          c.modResults.contents = c.modResults.contents.replaceAll(
            '\nimplementation(enforcedPlatform("com.squareup.okhttp3:okhttp-bom:4.12.0"))',
            "",
          );
          c.modResults.contents = c.modResults.contents.replace(
            /dependencies\s*\{/,
            '$&\nimplementation(enforcedPlatform("com.squareup.okhttp3:okhttp-bom:4.12.0"))', // cspell:ignore okhttp
          );
          return c;
        }),
        (configWithManifest) => {
          const manifest = configWithManifest.modResults;
          manifest.manifest.$["xmlns:tools"] ??= "http://schemas.android.com/tools";
          const mainApplication = AndroidConfig.Manifest.getMainApplication(manifest);
          if (!mainApplication) return configWithManifest;
          const MLKIT_META_NAME = "com.google.mlkit.vision.DEPENDENCIES"; // cspell:ignore mlkit
          const GOOGLE_PAY_META_NAME = "com.google.android.gms.wallet.api.enabled";
          mainApplication["meta-data"] =
            mainApplication["meta-data"]?.filter(
              ({ $ }) => ![GOOGLE_PAY_META_NAME, MLKIT_META_NAME].includes($["android:name"]),
            ) ?? [];
          mainApplication["meta-data"].push(
            {
              $: {
                "android:name": MLKIT_META_NAME,
                "android:value": "ocr,face,barcode,barcode_ui",
                // @ts-expect-error xmlns:tools
                "tools:replace": "android:value",
              },
            },
            {
              $: {
                "android:name": GOOGLE_PAY_META_NAME,
                "android:value": "true",
              },
            },
          );
          configWithManifest.modResults = manifest;
          return configWithManifest;
        },
      )) satisfies ConfigPlugin,
  ],
  experiments: { typedRoutes: true },
  extra: {
    eas: {
      projectId: "06bc0158-d23b-430b-a7e8-802df03c450b",
      build: {
        experimental: {
          ios: {
            appExtensions: [
              {
                targetName: walletExtensionTarget,
                bundleIdentifier: "app.exactly.WalletExtension",
                entitlements: {
                  "com.apple.developer.payment-pass-provisioning": true,
                  "com.apple.security.application-groups": [appGroupIdentifier],
                  "keychain-access-groups": [keychainAccessGroup],
                },
              },
            ],
          },
        },
      },
    },
  },
  updates: { url: "https://u.expo.dev/06bc0158-d23b-430b-a7e8-802df03c450b" },
  runtimeVersion: { policy: "fingerprint" },
  owner: "exactly",
  locales: { es: "src/i18n/native/es.json", pt: "src/i18n/native/pt.json" },
} satisfies ExpoConfig;

function injectPodfilePostInstall(contents: string, marker: string, patch: string) {
  if (contents.includes(marker)) return contents;
  const updatedContents = contents.replace(/(\s{4}react_native_post_install\([\s\S]*?\n\s{4}\)\n)/, `$1${patch}`);
  if (updatedContents === contents) throw new Error(`meawallet: failed to inject ${marker} into ios/Podfile`);
  return updatedContents;
}

function getWalletExtensionPodfilePatch() {
  return `    patchMeaWalletAppDelegateModulemap = lambda do
      next if File.exist?("#{installer.sandbox.root}/Headers/Public/React_RCTAppDelegate/React-RCTAppDelegate.modulemap")
      rctHeaders = "#{installer.sandbox.root}/Headers/Public/React-RCTAppDelegate"
      Dir.mkdir(rctHeaders) unless Dir.exist?(rctHeaders)
      File.write("#{rctHeaders}/React-RCTAppDelegate-umbrella.h", <<~'H')
        #ifdef __OBJC__
        #import <UIKit/UIKit.h>
        #endif
        #import "RCTAppDelegate.h"
        #import "RCTAppSetupUtils.h"
        #import "RCTArchConfiguratorProtocol.h"
        #import "RCTDefaultReactNativeFactoryDelegate.h"
        #import "RCTDependencyProvider.h"
        #import "RCTJSRuntimeConfiguratorProtocol.h"
        #import "RCTReactNativeFactory.h"
        #import "RCTRootViewFactory.h"
        #import "RCTUIConfiguratorProtocol.h"
      H
      File.write("#{rctHeaders}/React_RCTAppDelegate.modulemap", <<~MAP)
        module React_RCTAppDelegate {
          umbrella header "React-RCTAppDelegate-umbrella.h"
          export *
          module * { export * }
        }
      MAP
      installer.pods_project.targets.each do |target|
        next unless target.name == "meawallet-react-native-mpp"
        target.build_configurations.each do |buildConfiguration|
          flags = buildConfiguration.build_settings["OTHER_SWIFT_FLAGS"] || "$(inherited)"
          next if flags.include?("React_RCTAppDelegate.modulemap")
          buildConfiguration.build_settings["OTHER_SWIFT_FLAGS"] =
            "#{flags} -Xcc -fmodule-map-file=\${PODS_ROOT}/Headers/Public/React-RCTAppDelegate/React_RCTAppDelegate.modulemap"
        end
      end
    end

    patchWalletExtensionSwiftCompatibility = lambda do
      swiftCompatibilityPath = '"$(DT_TOOLCHAIN_DIR)/usr/lib/swift/$(PLATFORM_NAME)"'
      Dir.glob("#{installer.sandbox.root}/Target Support Files/Pods-ExaWalletExtension/Pods-ExaWalletExtension.*.xcconfig").each do |xcconfig|
        contents = File.read(xcconfig)
        updated = contents.gsub(/^LIBRARY_SEARCH_PATHS = .+$/) do |paths|
          paths.include?(swiftCompatibilityPath) ? paths : paths + " " + swiftCompatibilityPath
        end
        File.write(xcconfig, updated) if updated != contents
      end
    end

    patchMeaWalletAppDelegateModulemap.call
    patchWalletExtensionSwiftCompatibility.call
  `;
}
