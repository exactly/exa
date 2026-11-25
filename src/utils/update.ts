import { Appearance, AppState, Platform } from "react-native";

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

import queryClient, { persist } from "./queryClient";
import reportError from "./reportError";
import { forget, remember } from "../app/+native-intent";
import splashDark from "../assets/splash-dark.png";
import splash from "../assets/splash.png";

let pending = newer(latestContext);
let available = pending || known(latestContext);
let started = false;
let launching: Promise<boolean> | undefined;
let wake: () => void = () => undefined;
const attempt = new Promise<void>((resolve) => {
  wake = resolve;
});
let checking: Promise<void> | undefined;
let reloading: Promise<boolean> | undefined;
let current: string | undefined;
const covers = new Set<symbol>();

export function check() {
  if (__DEV__ || pending) return Promise.resolve();
  checking ??= checkForUpdateAsync()
    .then(async ({ isAvailable, isRollBackToEmbedded }) => {
      if (!isAvailable && !isRollBackToEmbedded) return;
      if (isAvailable || !isEmbeddedLaunch) available = true;
      const { isNew, isRollBackToEmbedded: rollback } = await fetchUpdateAsync().catch((error: unknown) => {
        available = false;
        throw error;
      });
      if (isNew || (rollback && !isEmbeddedLaunch)) pending = true;
    })
    .catch((error: unknown) => {
      reportError(error, { level: "info" });
    })
    .finally(() => {
      checking = undefined;
      wake();
    });
  return checking;
}

export function settle() {
  if (!checking) return Promise.resolve();
  return Promise.race([checking, new Promise<void>((resolve) => setTimeout(resolve, 3000))]);
}

export function cover({ native = false } = {}) {
  const id = Symbol("cover");
  covers.add(id);
  let away = false;
  const subscription =
    native && Platform.OS === "android"
      ? AppState.addEventListener("change", (status) => {
          if (status !== "active") away = true;
          else if (away) uncover();
        })
      : undefined;
  function uncover() {
    subscription?.remove();
    covers.delete(id);
  }
  return uncover;
}

export function covered() {
  return covers.size > 0;
}

export function track(route: string) {
  current = route;
}

export function reload(route?: string, { boot = false } = {}) {
  if (!pending || covers.size > 0 || queryClient.isMutating() > 0) return Promise.resolve(false);
  reloading ??= restart(route ?? current, boot || route !== undefined).then((reloaded) => {
    if (!reloaded) reloading = undefined;
    return reloaded;
  });
  return reloading;
}

const downloaded = new Promise<void>((resolve) => {
  if (pending) resolve();
  addUpdatesStateChangeListener(({ context }) => {
    if (known(context)) available = true;
    if (context.downloadError && !context.isDownloading && !newer(context)) {
      available = false;
      wake();
    }
    if (!newer(context)) return;
    pending = true;
    resolve();
  });
});

Promise.race([check(), downloaded, new Promise((resolve) => setTimeout(resolve, 3000))])
  .then(() => (started ? false : reload(undefined, { boot: true })))
  .catch(reportError);

export function launch() {
  launching ??=
    pending || available
      ? Promise.race([downloaded, attempt, new Promise((resolve) => setTimeout(resolve, 30_000))]).then(() =>
          reload(undefined, { boot: true }),
        )
      : Promise.resolve(false);
  started = true;
  return launching;
}

async function restart(route: string | undefined, fixed: boolean) {
  const at = current;
  try {
    if (route) await remember(route);
    await persist().catch(reportError);
    if ((fixed || !route || current === at) && covers.size === 0 && queryClient.isMutating() === 0) {
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

function known({ isUpdateAvailable, downloadError, latestManifest, rollback }: UpdatesNativeStateMachineContext) {
  return (
    isUpdateAvailable &&
    !downloadError &&
    (rollback ? !isEmbeddedLaunch : !!latestManifest && latestManifest.id !== updateId)
  );
}

function newer({ isUpdatePending, downloadedManifest, rollback }: UpdatesNativeStateMachineContext) {
  return isUpdatePending && (rollback ? !isEmbeddedLaunch : !!downloadedManifest && downloadedManifest.id !== updateId);
}
