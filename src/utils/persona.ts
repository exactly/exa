import { Platform } from "react-native";
import type { Environment } from "react-native-persona";

import { router } from "expo-router";

import { sdk } from "@farcaster/miniapp-sdk";

import domain from "@exactly/common/domain";

import queryClient, { type EmbeddingContext } from "./queryClient";
import reportError from "./reportError";
import { getKYCTokens } from "./server";

import type * as PersonaWeb from "persona";

export const environment = (__DEV__ || process.env.EXPO_PUBLIC_ENV === "e2e" ? "sandbox" : "production") as Environment;

export const startKYC = (
  Platform.OS === "web"
    ? () => {
        let activeClient: InstanceType<typeof PersonaWeb.Client> | undefined;

        return async () => {
          const [{ Client }, { inquiryId, sessionToken }] = await Promise.all([
            import("persona"),
            getKYCTokens("basic", await getRedirectURI()),
          ]);

          activeClient?.destroy();
          activeClient = new Client({
            inquiryId,
            sessionToken,
            environment: environment as "production" | "sandbox", // TODO implement environmentId
            onReady: () => activeClient?.open(),
            onComplete: () => {
              activeClient?.destroy();
              activeClient = undefined;
              handleComplete();
            },
            onCancel: () => {
              activeClient?.destroy();
              activeClient = undefined;
              handleCancel();
            },
            onError: (error) => {
              activeClient?.destroy();
              activeClient = undefined;
              reportError(error);
            },
          });
        };
      }
    : () => startNativeKYC
)();

async function getRedirectURI() {
  const miniappContext = (await sdk.context) as unknown as undefined | { client: { appUrl?: string } };
  if (miniappContext?.client.appUrl) return miniappContext.client.appUrl;
  switch (queryClient.getQueryData<EmbeddingContext>(["embedding-context"])) {
    case "farcaster-web":
      return `https://farcaster.xyz/miniapps/${
        {
          "web.exactly.app": "410vYppvUo1p", // cspell:ignore 410vYppvUo1p
          "sandbox.exactly.app": "nsbPHUIBynR4", // cspell:ignore nsbPHUIBynR4
        }[domain]
      }/exa-app`;
  }
}

function handleComplete() {
  queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
  queryClient.setQueryData(["card-upgrade"], 1);
  router.replace("/(main)/(home)");
}

function handleCancel() {
  queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
  router.replace("/(main)/(home)");
}

async function startNativeKYC() {
  const { inquiryId, sessionToken } = await getKYCTokens("basic", await getRedirectURI());
  const { Inquiry } = await import("react-native-persona");
  Inquiry.fromInquiry(inquiryId)
    .sessionToken(sessionToken)
    .onCanceled(handleCancel)
    .onComplete(handleComplete)
    .onError((error) => reportError(error))
    .build()
    .start();
}
