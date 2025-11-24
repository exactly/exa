import appId from "@exactly/common/onesignalAppId";
import { Platform } from "react-native";
import type * as OneSignalNative from "react-native-onesignal";
import type * as OneSignalWeb from "react-onesignal";

import reportError from "./reportError";

const { enablePrompt, login, logout } = (
  Platform.OS === "web"
    ? () => {
        const { default: OneSignal } = require("react-onesignal") as typeof OneSignalWeb; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        const init =
          appId && typeof window !== "undefined"
            ? OneSignal.init({
                appId,
                allowLocalhostAsSecureOrigin: __DEV__,
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
        const { OneSignal } = require("react-native-onesignal") as typeof OneSignalNative; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        if (appId) OneSignal.initialize(appId);
        return {
          enablePrompt: () => {
            if (appId && process.env.EXPO_PUBLIC_ENV !== "e2e") OneSignal.InAppMessages.addTrigger("onboard", "1");
          },
          login: (userId: string) => {
            if (appId) OneSignal.login(userId);
          },
          logout: () => {
            if (appId) OneSignal.logout();
          },
        };
      }
)();

export { enablePrompt, login, logout };
