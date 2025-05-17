import deriveAddress from "@exactly/common/deriveAddress";
import type { Passkey } from "@exactly/common/validation";
import type * as IntercomNative from "@intercom/intercom-react-native";
import type * as IntercomWeb from "@intercom/messenger-js-sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import reportError from "./reportError";

const appId = process.env.EXPO_PUBLIC_INTERCOM_APP_ID;

const { login, present, presentArticle } = (
  Platform.OS === "web"
    ? () => {
        const { Intercom, showArticle, showSpace } = require("@intercom/messenger-js-sdk") as typeof IntercomWeb; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
        return {
          login: (userId: string, credentialId: string) => {
            if (!appId) return Promise.resolve(false);
            Intercom({ app_id: appId, user_id: userId, companies: [{ id: credentialId }] });
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
          present: () => Intercom.presentSpace(Space.home),
          presentArticle: (articleId: string) =>
            Intercom.presentContent(IntercomContent.articleWithArticleId(articleId)),
        };
      }
)();

export default function useIntercom() {
  const [loggedIn, setLoggedIn] = useState(false);
  const { data: passkey } = useQuery<Passkey>({ queryKey: ["passkey"] });
  useEffect(() => {
    if (!passkey || loggedIn) return;
    login(deriveAddress(passkey.factory, { x: passkey.x, y: passkey.y }), passkey.credentialId)
      .then(setLoggedIn)
      .catch(reportError);
  }, [passkey, loggedIn]);
  return { loggedIn, present, presentArticle };
}
