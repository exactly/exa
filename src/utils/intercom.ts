import type * as IntercomNative from "@intercom/intercom-react-native";
import type * as IntercomWeb from "@intercom/messenger-js-sdk";
import { Platform } from "react-native";

import { showUpdateModal } from "./modals";
import openBrowser from "./openBrowser";
import reportError from "./reportError";

const appId = process.env.EXPO_PUBLIC_INTERCOM_APP_ID;

export const { login, logout, newMessage, present, presentArticle, presentCollection } = (
  Platform.OS === "web"
    ? () => {
        const { Intercom, showArticle, showSpace, showNewMessage } =
          require("@intercom/messenger-js-sdk") as typeof IntercomWeb; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        return {
          login: (userId: string, token: string) => {
            if (!appId) return Promise.resolve(false);
            try {
              Intercom({ app_id: appId, user_id: userId, intercom_user_jwt: token });
              return Promise.resolve(true);
            } catch (error: unknown) {
              reportError(error);
              return Promise.resolve(false);
            }
          },
          logout: () => {
            return Promise.resolve(true);
          },
          present: () => {
            showSpace("home");
            return Promise.resolve(true);
          },
          presentArticle: (articleId: string) => {
            showArticle(articleId);
            return Promise.resolve(true);
          },
          presentCollection: async (collectionId: string) => {
            await openBrowser(`https://intercom.help/exa-app/en/collections/${collectionId}`);
            return true;
          },
          newMessage: (message: string) => {
            showNewMessage(message);
            return Promise.resolve(true);
          },
        };
      }
    : () => {
        const { default: Intercom } = require("@intercom/intercom-react-native") as typeof IntercomNative; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        return {
          login: (userId: string, token: string) =>
            appId
              ? Intercom.setUserHash(token)
                  .then(() => Intercom.loginUserWithUserAttributes({ userId }))
                  .then(() => true)
                  .catch((error: unknown) => {
                    reportError(error);
                    return false;
                  })
              : Promise.resolve(false),
          logout: () => Intercom.logout(),
          present: () => {
            showUpdateModal();
            return Promise.resolve();
          },
          presentArticle: (_articleId: string) => {
            showUpdateModal();
            return Promise.resolve();
          },
          presentCollection: (_collectionId: string) => {
            showUpdateModal();
            return Promise.resolve();
          },
          newMessage: (_message: string) => {
            showUpdateModal();
            return Promise.resolve();
          },
        };
      }
)();
