import type { Router } from "expo-router";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { startRampOnboarding } from "./server";

export default async function completeOnboarding(
  router: Router,
  currency: string,
  provider: "bridge" | "manteca" = "manteca",
  acceptedTermsId?: string,
  network?: string,
  direction: "offramp" | "onramp" = "onramp",
) {
  const offramp = direction === "offramp";
  try {
    if (provider === "bridge" && !acceptedTermsId) throw new Error("missing acceptedTermsId for bridge");
    const onboarding: Parameters<typeof startRampOnboarding>[0] =
      provider === "bridge" ? { provider: "bridge", acceptedTermsId: acceptedTermsId ?? "" } : { provider: "manteca" };
    const result = await startRampOnboarding(onboarding);
    queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
    if ("inquiryId" in result) {
      queryClient.setQueryData(["ramp", "kyc-tokens", provider, direction], {
        inquiryId: result.inquiryId,
        sessionToken: result.sessionToken,
      });
      router.replace({
        pathname: offramp ? "/send-funds/kyc" : "/add-funds/kyc",
        params: { currency, provider, network, kycCode: result.code, acceptedTermsId, direction },
      });
      return;
    }
    router.replace({
      pathname: offramp ? "/send-funds/status" : "/add-funds/status",
      params: { status: "ONBOARDING", currency, provider, pending: "true", network, direction },
    });
  } catch (error) {
    reportError(error);
    router.replace({
      pathname: offramp ? "/send-funds/status" : "/add-funds/status",
      params: { status: "error", currency, provider, network, direction },
    });
  }
}
