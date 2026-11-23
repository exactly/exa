import { Appearance, Platform } from "react-native";

import Constants from "expo-constants";
import {
  addUpdatesStateChangeListener,
  checkForUpdateAsync,
  fetchUpdateAsync,
  isEmbeddedLaunch,
  latestContext,
  reloadAsync,
  updateId,
} from "expo-updates";
import type { UpdatesNativeStateMachineContext } from "expo-updates";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { forget, remember } from "../app/+native-intent";
import splashDark from "../assets/splash-dark.png";
import splash from "../assets/splash.png";

let pending = newer(latestContext);
let checking: Promise<void> | undefined;
let reloading: Promise<boolean> | undefined;
let current: string | undefined;

export function check() {
  if (__DEV__) return Promise.resolve();
  checking ??= checkForUpdateAsync()
    .then(async ({ isAvailable, isRollBackToEmbedded }) => {
      if (!isAvailable && !isRollBackToEmbedded) return;
      const { isNew, isRollBackToEmbedded: rollback } = await fetchUpdateAsync();
      if (isNew || (rollback && !isEmbeddedLaunch)) pending = true;
    })
    .catch((error: unknown) => {
      reportError(error, { level: "info" });
    })
    .finally(() => {
      checking = undefined;
    });
  return checking;
}

export function settle() {
  return checking ?? Promise.resolve();
}

export function track(route: string) {
  current = route;
}

export function reload(route = current) {
  if (!pending || queryClient.isMutating() > 0) return Promise.resolve(false);
  reloading ??= restart(route).then((reloaded) => {
    if (!reloaded) reloading = undefined;
    return reloaded;
  });
  return reloading;
}

const downloaded = new Promise<void>((resolve) => {
  if (pending) resolve();
  addUpdatesStateChangeListener(({ context }) => {
    if (!newer(context)) return;
    pending = true;
    resolve();
  });
});

export const launch = Promise.race([check(), downloaded, new Promise((resolve) => setTimeout(resolve, 3000))]).then(
  () => reload(),
);

async function restart(route?: string) {
  try {
    if (route) await remember(route);
    if (queryClient.isMutating() === 0) {
      const dark = Appearance.getColorScheme() === "dark";
      const screen = Platform.OS === "ios" ? Constants.expoConfig?.ios?.splash : Constants.expoConfig?.android?.splash;
      await reloadAsync({
        reloadScreenOptions: {
          backgroundColor: dark ? screen?.dark?.backgroundColor : screen?.backgroundColor,
          ...(Platform.OS === "ios" && { image: dark ? splashDark : splash, imageResizeMode: "contain" }),
        },
      });
      return true;
    }
  } catch (error: unknown) {
    reportError(error);
  }
  if (route) await forget().catch(reportError);
  return false;
}

function newer({ isUpdatePending, downloadedManifest, rollback }: UpdatesNativeStateMachineContext) {
  return isUpdatePending && (rollback ? !isEmbeddedLaunch : !!downloadedManifest && downloadedManifest.id !== updateId);
}
