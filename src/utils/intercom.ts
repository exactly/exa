import { Platform } from "react-native";

import openBrowser from "./openBrowser";
import queryClient, { hydrated, isServer } from "./queryClient";
import reportError from "./reportError";

import type * as IntercomNative from "@intercom/intercom-react-native";
import type * as IntercomWeb from "@intercom/messenger-js-sdk";

export const { login, logout, newMessage, present, presentArticle, presentCollection } = (
  Platform.OS === "web"
    ? () => {
        const { Intercom, boot, showArticle, showSpace, showNewMessage, shutdown, update } =
          require("@intercom/messenger-js-sdk") as typeof IntercomWeb; // eslint-disable-line unicorn/prefer-module
        return {
          login: (userId: string, token: string, expires: number) => {
            if (!appId) return Promise.resolve(false);
            try {
              if (window.Intercom && queryClient.getQueryData<Session>(["intercom"])?.userId === userId) {
                update({ user_id: userId, intercom_user_jwt: token });
              } else {
                queryClient.removeQueries({ queryKey: ["intercom"] });
                if (window.Intercom) shutdown();
                (window.Intercom ? boot : Intercom)({ app_id: appId, user_id: userId, intercom_user_jwt: token });
              }
              queryClient.setQueryData<Session>(["intercom"], { expires, userId });
              return Promise.resolve(true);
            } catch (error: unknown) {
              reportError(error);
              return Promise.resolve(false);
            }
          },
          logout: () => {
            if (window.Intercom) shutdown();
            queryClient.removeQueries({ queryKey: ["intercom"] });
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
        const {
          default: Intercom,
          IntercomContent,
          Space,
        } = require("@intercom/intercom-react-native") as typeof IntercomNative; // eslint-disable-line unicorn/prefer-module
        return {
          login: async (userId: string, token: string, expires: number) => {
            if (!appId) return false;
            try {
              const same = queryClient.getQueryData<Session>(["intercom"])?.userId === userId;
              if (!same) {
                queryClient.removeQueries({ queryKey: ["intercom"] });
                await Intercom.logout().catch(() => undefined);
              }
              await Intercom.setUserJwt(token);
              if (!same) await Intercom.loginUserWithUserAttributes({ userId });
              queryClient.setQueryData<Session>(["intercom"], { expires, userId });
              return true;
            } catch (error: unknown) {
              reportError(error);
              return false;
            }
          },
          logout: async () => {
            await Intercom.logout().catch(reportError);
            queryClient.removeQueries({ queryKey: ["intercom"] });
            return true;
          },
          present: () => Intercom.presentSpace(Space.home),
          presentArticle: (articleId: string) =>
            Intercom.presentContent(IntercomContent.articleWithArticleId(articleId)),
          presentCollection: (collectionId: string) =>
            Intercom.presentContent(IntercomContent.helpCenterCollectionsWithIds([collectionId])),
          newMessage: (message: string) => Intercom.presentMessageComposer(message),
        };
      }
)();

const appId = process.env.EXPO_PUBLIC_INTERCOM_APP_ID;

hydrated.then(
  () => {
    if (isServer) return;
    const saved = queryClient.getQueryData<Session>(["intercom"]);
    if (saved && saved.expires < Date.now()) queryClient.removeQueries({ queryKey: ["intercom"] });
    const auth = queryClient.getQueryData<number>(["auth"]);
    if (!saved && auth !== undefined && auth > Date.now())
      queryClient.setQueryData<Session>(["intercom"], { expires: auth });
    if (Platform.OS !== "web" || !appId || window.Intercom || !queryClient.getQueryData(["intercom"])) return;
    (require("@intercom/messenger-js-sdk") as typeof IntercomWeb).Intercom({ app_id: appId }); // eslint-disable-line unicorn/prefer-module
  },
  () => undefined,
);

export type Session = { expires: number; userId?: string };
