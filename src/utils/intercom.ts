import { sdk } from "@farcaster/miniapp-sdk";
import type * as IntercomNative from "@intercom/intercom-react-native";
import type * as IntercomWeb from "@intercom/messenger-js-sdk";
import { openBrowserAsync } from "expo-web-browser";
import { Platform } from "react-native";

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
            await ((await sdk.isInMiniApp())
              ? sdk.actions.openUrl(`https://intercom.help/exa-app/en/collections/${collectionId}`)
              : openBrowserAsync(`https://intercom.help/exa-app/en/collections/${collectionId}`));
            return true;
          },
          newMessage: (message: string) => {
            showNewMessage(message);
            return Promise.resolve(true);
          },
        };
      }
    : () => {
        const {
          default: Intercom,
          IntercomContent,
          Space,
        } = require("@intercom/intercom-react-native") as typeof IntercomNative; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
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
          present: () => Intercom.presentSpace(Space.home),
          presentArticle: (articleId: string) =>
            Intercom.presentContent(IntercomContent.articleWithArticleId(articleId)),
          presentCollection: (collectionId: string) =>
            Intercom.presentContent(IntercomContent.helpCenterCollectionsWithIds([collectionId])),
          newMessage: (message: string) => Intercom.presentMessageComposer(message),
        };
      }
)();
