import domain from "@exactly/common/domain";
import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import { router } from "expo-router";
import { Platform } from "react-native";
import { Environment, Inquiry } from "react-native-persona";

import queryClient, { type EmbeddingContext } from "./queryClient";
import reportError from "./reportError";
import { getKYCLink } from "./server";

export const environment =
  __DEV__ || process.env.EXPO_PUBLIC_ENV === "e2e" ? Environment.SANDBOX : Environment.PRODUCTION;
export const KYC_TEMPLATE_ID = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";
export const LEGACY_KYC_TEMPLATE_ID = "itmpl_8uim4FvD5P3kFpKHX37CW817";

export async function createInquiry(credential: Credential) {
  if (Platform.OS === "web") {
    const url = await getKYCLink(KYC_TEMPLATE_ID, await getRedirectURI());
    const embeddingContext = queryClient.getQueryData<EmbeddingContext>(["embedding-context"]);
    if (embeddingContext && !embeddingContext.endsWith("-web")) {
      window.location.replace(url);
      return;
    }
    window.open(url);
    return;
  }

  Inquiry.fromTemplate(KYC_TEMPLATE_ID)
    .environment(environment)
    .referenceId(credential.credentialId)
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

export async function resumeInquiry(inquiryId: string, sessionToken: string) {
  if (Platform.OS === "web") {
    const url = await getKYCLink(KYC_TEMPLATE_ID);
    if (await sdk.isInMiniApp()) {
      await sdk.actions.openUrl(url);
      return;
    }
    const embeddingContext = queryClient.getQueryData<EmbeddingContext>(["embedding-context"]);
    if (embeddingContext && !embeddingContext.endsWith("-web")) {
      window.location.replace(url);
      return;
    }
    window.open(url);
    return;
  }

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
    .build()
    .start();
}

async function getRedirectURI() {
  const miniappContext = (await sdk.context) as unknown as { client: { appUrl?: string } } | undefined;
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
