import "../utils/onesignal";

import React, { useLayoutEffect as useClientLayoutEffect, useEffect } from "react";
import { initReactI18next } from "react-i18next";
import { AppState, Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { isRunningInExpoGo } from "expo";
import { useAssets } from "expo-asset";
import { useFonts, type FontSource } from "expo-font";
import { getLocales } from "expo-localization";
import { SplashScreen, Stack, useNavigationContainerRef } from "expo-router";
import { channel, checkForUpdateAsync, fetchUpdateAsync, reloadAsync } from "expo-updates";

import { ToastProvider } from "@tamagui/toast";

import {
  ErrorBoundary,
  feedbackIntegration,
  init,
  mobileReplayIntegration,
  reactNavigationIntegration,
  wrap,
} from "@sentry/react-native";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { reconnect } from "@wagmi/core";
import { use as configI18n } from "i18next";
import { WagmiProvider } from "wagmi";

import domain from "@exactly/common/domain";

import BDOGroteskDemiBold from "../assets/fonts/BDOGrotesk-DemiBold.otf";
import BDOGroteskRegular from "../assets/fonts/BDOGrotesk-Regular.otf";
import IBMPlexMonoMedium from "../assets/fonts/IBMPlexMono-Medm.otf";
import AppIcon from "../assets/icon.png";
import ThemeProvider from "../components/context/ThemeProvider";
import Error from "../components/shared/Error";
import release from "../generated/release";
import en from "../i18n/en.json";
import es from "../i18n/es.json";
import e2e from "../utils/e2e";
import queryClient, { persistOptions } from "../utils/queryClient";
import reportError, { classifyError } from "../utils/reportError";
import exaConfig from "../utils/wagmi/exa";
import ownerConfig from "../utils/wagmi/owner";

SplashScreen.preventAutoHideAsync().catch(reportError);

configI18n(initReactI18next)
  .use({
    type: "languageDetector",
    detect: () =>
      getLocales()[0]?.languageCode ??
      (typeof navigator === "undefined" ? undefined : navigator.language.split("-")[0]) ??
      "en",
  })
  .init({
    fallbackLng: "en",
    keySeparator: false,
    nsSeparator: false,
    resources: { en: { translation: en }, es: { translation: es } },
  })
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
  environment: e2e ? "e2e" : __DEV__ ? "development" : (channel ?? "production"),
  tracesSampleRate: 1,
  attachStacktrace: true,
  attachViewHierarchy: true,
  enableAutoSessionTracking: true,
  tracePropagationTargets: [domain],
  enableNativeFramesTracking: !isRunningInExpoGo(),
  enableUserInteractionTracing: true,
  integrations: [routingInstrumentation, userFeedback, ...(__DEV__ || e2e ? [] : [mobileReplayIntegration()])],
  _experiments: __DEV__ || e2e ? undefined : { replaysOnErrorSampleRate: 1, replaysSessionSampleRate: 0.01 },
  beforeSend: (event, hint) => {
    let known = false;
    for (const source of [
      hint.originalException,
      ...(event.exception?.values?.map(({ value }) => value) ?? []),
      event.message,
    ]) {
      const classification = classifyError(source);
      if (classification.known) known = true;
      event.fingerprint ??= classification.fingerprint;
    }
    if (known) event.level = "warning";
    return event;
  },
  spotlight: __DEV__ || !!e2e,
});
const useServerFonts = typeof window === "undefined" ? useFonts : () => undefined;
const useServerAssets = typeof window === "undefined" ? useAssets : () => undefined;
const useLayoutEffect = typeof window === "undefined" ? () => undefined : useClientLayoutEffect;
const devtools = !!JSON.parse(process.env.EXPO_PUBLIC_DEVTOOLS ?? String(Platform.OS === "web" && __DEV__));

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
    reconnect(exaConfig)
      .then(() => reconnect(ownerConfig))
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
      <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
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
