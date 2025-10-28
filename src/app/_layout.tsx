import { optimism } from "@alchemy/aa-core";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import domain from "@exactly/common/domain";
import chain from "@exactly/common/generated/chain";
import { createConfig, EVM } from "@lifi/sdk";
import {
  ErrorBoundary,
  feedbackIntegration,
  init,
  mobileReplayIntegration,
  reactNavigationIntegration,
  wrap,
} from "@sentry/react-native";
import { ToastProvider } from "@tamagui/toast";
// @ts-expect-error hack before metro supports exports
import { ReactQueryDevtools } from "@tanstack/react-query-devtools/build/modern/production"; // HACK improve after expo 53
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { reconnect } from "@wagmi/core";
import { isRunningInExpoGo } from "expo";
import { useAssets } from "expo-asset";
import { type FontSource, useFonts } from "expo-font";
import { SplashScreen, Stack, useNavigationContainerRef } from "expo-router";
import { channel, checkForUpdateAsync, fetchUpdateAsync, reloadAsync } from "expo-updates";
import { use as configI18n } from "i18next";
import React, { useEffect, useLayoutEffect as useClientLayoutEffect } from "react";
import { initReactI18next } from "react-i18next";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { WagmiProvider } from "wagmi";

import BDOGroteskDemiBold from "../assets/fonts/BDOGrotesk-DemiBold.otf";
import BDOGroteskRegular from "../assets/fonts/BDOGrotesk-Regular.otf";
import IBMPlexMonoMedium from "../assets/fonts/IBMPlexMono-Medm.otf";
import AppIcon from "../assets/icon.png";
import ThemeProvider from "../components/context/ThemeProvider";
import Error from "../components/shared/Error";
import release from "../generated/release";
import translation from "../i18n/en.json";
import publicClient from "../utils/publicClient";
import queryClient, { persister } from "../utils/queryClient";
import reportError from "../utils/reportError";
import exaConfig from "../utils/wagmi/exa";
import ownerConfig, { getConnector as getOwnerConnector } from "../utils/wagmi/owner";

SplashScreen.preventAutoHideAsync().catch(reportError);

configI18n(initReactI18next)
  .init({ fallbackLng: "en", resources: { en: { translation } } })
  .catch(reportError);

export { ErrorBoundary } from "expo-router";
const routingInstrumentation = reactNavigationIntegration({ enableTimeToInitialDisplay: !isRunningInExpoGo() });
const userFeedback = feedbackIntegration({
  showName: false,
  showEmail: false,
  showBranding: false,
  formTitle: "Send report error",
  messageLabel: "Describe the issue",
  messagePlaceholder: "",
  submitButtonLabel: "Send report",
  cancelButtonLabel: "Cancel",
  styles: {
    container: { gap: 12, padding: 16 },
    label: { fontWeight: "bold" },
    textArea: { minHeight: 150, borderWidth: 1, borderColor: "#CCCCCC", borderRadius: 5 },
    input: { borderWidth: 1, borderRadius: 5, padding: 5, color: "#000000" },
    submitButton: {
      height: 50,
      borderRadius: 5,
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "#12A594",
    },
    cancelButton: {
      height: 50,
      borderRadius: 5,
      width: "100%",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
    },
  },
});
init({
  release,
  dsn:
    process.env.EXPO_PUBLIC_SENTRY_DSN ??
    "https://ac8875331e4cecd67dd0a7519a36dfeb@o1351734.ingest.us.sentry.io/4506186349674496",
  environment: __DEV__ ? "development" : (channel ?? "production"),
  tracesSampleRate: 1,
  attachStacktrace: true,
  attachViewHierarchy: true,
  autoSessionTracking: true,
  tracePropagationTargets: [domain],
  enableNativeFramesTracking: !isRunningInExpoGo(),
  enableUserInteractionTracing: true,
  integrations: [routingInstrumentation, ...(__DEV__ ? [] : [mobileReplayIntegration()]), userFeedback],
  _experiments: __DEV__ ? undefined : { replaysOnErrorSampleRate: 1, replaysSessionSampleRate: 0.01 },
  spotlight: __DEV__,
});
const useServerFonts = typeof window === "undefined" ? useFonts : () => undefined;
const useServerAssets = typeof window === "undefined" ? useAssets : () => undefined;
const useLayoutEffect = typeof window === "undefined" ? () => undefined : useClientLayoutEffect;
const devtools = !!JSON.parse(process.env.EXPO_PUBLIC_DEVTOOLS ?? String(Platform.OS === "web" && __DEV__));
createConfig({
  integrator: "exa_app",
  apiKey: "4bdb54aa-4f28-4c61-992a-a2fdc87b0a0b.251e33ad-ef5e-40cb-9b0f-52d634b99e8f",
  providers: [EVM({ getWalletClient: () => Promise.resolve(publicClient) })],
  rpcUrls: {
    [optimism.id]: [`${optimism.rpcUrls.alchemy?.http[0]}/${alchemyAPIKey}`],
    [chain.id]: [publicClient.transport.url],
  },
});

export default wrap(function RootLayout() {
  const navigationContainer = useNavigationContainerRef();

  useServerFonts({
    "BDOGrotesk-DemiBold": BDOGroteskDemiBold as FontSource,
    "BDOGrotesk-Regular": BDOGroteskRegular as FontSource,
    "IBMPlexMono-Medm": IBMPlexMonoMedium as FontSource,
  });
  useServerAssets([AppIcon]);
  useEffect(() => {
    routingInstrumentation.registerNavigationContainer(navigationContainer);
  }, [navigationContainer]);

  useEffect(() => {
    reconnect(exaConfig).catch(reportError);
    getOwnerConnector()
      .then((connector) => reconnect(ownerConfig, { connectors: [connector] }))
      .catch(reportError);

    if (__DEV__) return;
    let shouldReload = false;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (shouldReload) {
          reloadAsync().catch(reportError);
          return;
        }
        checkForUpdateAsync()
          .then(async ({ isAvailable, isRollBackToEmbedded }) => {
            if (!isAvailable && !isRollBackToEmbedded) return;
            await fetchUpdateAsync();
            shouldReload = true;
          })
          .catch(reportError);
      }
    });
    return () => {
      subscription.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const loader = document.querySelector("#app-loader");
    const root = document.querySelector("#root");
    if (!(loader instanceof HTMLElement) || !(root instanceof HTMLElement)) return;
    root.style.visibility = "visible";
    loader.remove();
  }, []);

  return (
    <WagmiProvider config={exaConfig}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
        <ToastProvider>
          <SafeAreaProvider>
            <ThemeProvider>
              <ErrorBoundary
                fallback={(data) => (
                  <Error
                    resetError={() => {
                      data.resetError();
                    }}
                  />
                )}
              >
                <Stack screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="(auth)" />
                  <Stack.Screen name="(main)" />
                </Stack>
              </ErrorBoundary>
            </ThemeProvider>
          </SafeAreaProvider>
          {devtools && <ReactQueryDevtools initialIsOpen={false} client={queryClient} />}
        </ToastProvider>
      </PersistQueryClientProvider>
    </WagmiProvider>
  );
});
