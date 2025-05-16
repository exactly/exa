import type { Passkey } from "@exactly/common/validation";
import { router } from "expo-router";
import { Platform } from "react-native";
import { Environment, Inquiry } from "react-native-persona";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { getKYCLink } from "./server";

export const environment = __DEV__ ? Environment.SANDBOX : Environment.PRODUCTION;
export const KYC_TEMPLATE_ID = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";
export const LEGACY_KYC_TEMPLATE_ID = "itmpl_8uim4FvD5P3kFpKHX37CW817";

export async function createInquiry(passkey: Passkey) {
  if (Platform.OS === "web") {
    const otl = await getKYCLink(KYC_TEMPLATE_ID);
    window.open(otl);
    return;
  }

  Inquiry.fromTemplate(KYC_TEMPLATE_ID)
    .environment(environment)
    .referenceId(passkey.credentialId)
    .onCanceled(() => {
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      router.replace("/(app)/(home)");
    })
    .onComplete(() => {
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      queryClient.setQueryData(["card-upgrade"], 1);
      router.replace("/(app)/(home)");
    })
    .onError(reportError)
    .build()
    .start();
}

export async function resumeInquiry(inquiryId: string, sessionToken: string) {
  if (Platform.OS === "web") {
    const otl = await getKYCLink(KYC_TEMPLATE_ID);
    window.open(otl);
    return;
  }

  Inquiry.fromInquiry(inquiryId)
    .sessionToken(sessionToken)
    .onCanceled(() => {
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      router.replace("/(app)/(home)");
    })
    .onComplete(() => {
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"] }).catch(reportError);
      queryClient.setQueryData(["card-upgrade"], 1);
      router.replace("/(app)/(home)");
    })
    .build()
    .start();
}
