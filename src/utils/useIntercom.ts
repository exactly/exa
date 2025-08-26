import deriveAddress from "@exactly/common/deriveAddress";
import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import type * as IntercomNative from "@intercom/intercom-react-native";
import type * as IntercomWeb from "@intercom/messenger-js-sdk";
import { useQuery } from "@tanstack/react-query";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import reportError from "./reportError";

const appId = process.env.EXPO_PUBLIC_INTERCOM_APP_ID;

const { login, logout, newMessage, present, presentArticle, presentCollection } = (
  Platform.OS === "web"
    ? () => {
        const { Intercom, showArticle, showSpace, showNewMessage } =
          require("@intercom/messenger-js-sdk") as typeof IntercomWeb; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        return {
          login: (userId: string, credentialId: string) => {
            if (!appId) return Promise.resolve(false);
            Intercom({ app_id: appId, user_id: userId, companies: [{ id: credentialId }] });
            return Promise.resolve(true);
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
          login: (userId: string, credentialId: string) =>
            appId
              ? Intercom.loginUserWithUserAttributes({ userId, companies: [{ id: credentialId }] }).catch(
                  (error: unknown) => {
                    reportError(error, { tags: { retry: true } });
                    return Intercom.loginUserWithUserAttributes({ userId });
                  },
                )
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

export default function useIntercom() {
  const [loggedIn, setLoggedIn] = useState(false);
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  useEffect(() => {
    if (!credential || loggedIn) return;
    login(deriveAddress(credential.factory, { x: credential.x, y: credential.y }), credential.credentialId)
      .then(setLoggedIn)
      .catch(reportError);
  }, [credential, loggedIn]);
  return { loggedIn, present, presentArticle, presentCollection, logout, newMessage };
}
