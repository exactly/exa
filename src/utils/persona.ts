import { Platform } from "react-native";
import type { Environment } from "react-native-persona";

import { router } from "expo-router";

import { sdk } from "@farcaster/miniapp-sdk";

import domain from "@exactly/common/domain";

import queryClient, { type EmbeddingContext } from "./queryClient";
import reportError from "./reportError";
import { getKYCTokens } from "./server";

export const environment = (__DEV__ || process.env.EXPO_PUBLIC_ENV === "e2e" ? "sandbox" : "production") as Environment;

export async function startKYC() {
  const { otl: oneTimeLink, inquiryId, sessionToken } = await getKYCTokens("basic", await getRedirectURI());

  if (Platform.OS === "web") {
    if (await sdk.isInMiniApp()) {
      await sdk.actions.openUrl(oneTimeLink);
      return;
    }
    const embeddingContext = queryClient.getQueryData<EmbeddingContext>(["embedding-context"]);
    if (embeddingContext && !embeddingContext.endsWith("-web")) {
      window.location.replace(oneTimeLink);
      return;
    }
    window.open(oneTimeLink, "_blank", "noopener,noreferrer");
    return;
  }

  const { Inquiry } = await import("react-native-persona");
  Inquiry.fromInquiry(inquiryId)
    .sessionToken(sessionToken)
    .onCanceled(() => {
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      router.replace("/(main)/(home)");
    })
    .onComplete(() => {
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      queryClient.setQueryData(["card-upgrade"], 1);
      router.replace("/(main)/(home)");
    })
    .onError((error) => reportError(error))
    .build()
    .start();
}

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
