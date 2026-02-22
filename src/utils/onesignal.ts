import { Platform } from "react-native";
import type * as OneSignalNative from "react-native-onesignal";
import type OneSignalWeb from "react-onesignal";

import appId from "@exactly/common/onesignalAppId";

import queryClient, { hydrated, persist } from "./queryClient";
import reportError from "./reportError";

const { enablePrompt, login, logout } = (
  Platform.OS === "web"
    ? () => {
        const OneSignal = require("react-onesignal") as typeof OneSignalWeb; // eslint-disable-line unicorn/prefer-module
        const init =
          appId && typeof window !== "undefined"
            ? OneSignal.init({
                appId,
                allowLocalhostAsSecureOrigin: __DEV__ || process.env.EXPO_PUBLIC_ENV === "e2e",
                notifyButton: {
                  enable: true,
                  prenotify: true,
                  showCredit: false,
                  text: {
                    "tip.state.unsubscribed": "Subscribe to notifications",
                    "tip.state.subscribed": "You're subscribed to notifications",
                    "tip.state.blocked": "You've blocked notifications",
                    "message.prenotify": "Click to subscribe to notifications",
                    "message.action.subscribed": "Thanks for subscribing!",
                    "message.action.subscribing": "Subscribing...",
                    "message.action.resubscribed": "You're subscribed to notifications",
                    "message.action.unsubscribed": "You won't receive notifications again",
                    "dialog.main.title": "Manage Site Notifications",
                    "dialog.main.button.subscribe": "SUBSCRIBE",
                    "dialog.main.button.unsubscribe": "UNSUBSCRIBE",
                    "dialog.blocked.title": "Unblock Notifications",
                    "dialog.blocked.message": "Follow these instructions to allow notifications:",
                  },
                  displayPredicate: () =>
                    new Promise((resolve) => {
                      displayPrompt = () => {
                        displayPrompt = undefined;
                        resolve(!OneSignal.Notifications.permission && OneSignal.Notifications.isPushSupported());
                      };
                    }),
                },
              }).catch(reportError)
            : undefined;
        let displayPrompt: (() => void) | undefined;
        return {
          enablePrompt: () => {
            init?.then(() => displayPrompt?.()).catch(reportError);
          },
          login: (userId: string) => {
            init?.then(() => OneSignal.login(userId)).catch(reportError);
          },
          logout: () => {
            init?.then(() => OneSignal.logout()).catch(reportError);
          },
        };
      }
    : () => {
        const { OneSignal } = require("react-native-onesignal") as typeof OneSignalNative; // eslint-disable-line unicorn/prefer-module
        queryClient.setQueryDefaults(["onesignal", "dismiss"], {
          initialData: 0,
          gcTime: Infinity,
          staleTime: Infinity,
          queryFn: () => queryClient.getQueryData(["onesignal", "dismiss"]),
        });
        if (appId) OneSignal.initialize(appId);
        const ready =
          appId && process.env.EXPO_PUBLIC_ENV === "e2e"
            ? new Promise<void>((resolve) => {
                let done = false;
                const finish = () => {
                  if (done) return;
                  done = true;
                  OneSignal.User.removeEventListener("change", listener);
                  OneSignal.login(Math.random().toString(36).slice(2));
                  resolve();
                };
                const listener: Parameters<typeof OneSignal.User.addEventListener>[1] = (event) => {
                  if (!event.current.onesignalId) return;
                  finish();
                };
                OneSignal.User.addEventListener("change", listener);
                OneSignal.User.getOnesignalId().then((onesignalId) => {
                  if (!onesignalId) return;
                  finish();
                }, reportError);
              })
            : Promise.resolve();
        OneSignal.InAppMessages.addEventListener("didDismiss", () => {
          queryClient.setQueryData(["onesignal", "dismiss"], Date.now());
          persist().catch(reportError);
          OneSignal.InAppMessages.removeTrigger("onboard");
        });
        return {
          enablePrompt: () => {
            Promise.all([hydrated, ready]).then(
              () => {
                const lastDismiss = queryClient.getQueryData<number>(["onesignal", "dismiss"]) ?? 0;
                if (!appId || lastDismiss + DISMISS_EXPIRY >= Date.now()) return;
                OneSignal.InAppMessages.addTrigger("onboard", "1");
              },
              () => undefined,
            );
          },
          login: (userId: string) => {
            if (appId && process.env.EXPO_PUBLIC_ENV !== "e2e") OneSignal.login(userId);
          },
          logout: () => {
            if (appId) OneSignal.logout();
          },
        };
      }
)();

export { enablePrompt, login, logout };

export const DISMISS_EXPIRY = 30 * 24 * 60 * 60 * 1000;
