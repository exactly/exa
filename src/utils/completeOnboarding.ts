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
) {
  try {
    if (provider === "bridge" && !acceptedTermsId) throw new Error("missing acceptedTermsId for bridge");
    const onboarding: Parameters<typeof startRampOnboarding>[0] =
      provider === "bridge" ? { provider: "bridge", acceptedTermsId: acceptedTermsId ?? "" } : { provider: "manteca" };
    const result = await startRampOnboarding(onboarding);
    queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
    if ("inquiryId" in result) {
      queryClient.setQueryData(["ramp", "kyc-tokens", provider], {
        inquiryId: result.inquiryId,
        sessionToken: result.sessionToken,
      });
      router.replace({
        pathname: "/add-funds/kyc",
        params: { currency, provider, network, kycCode: result.code, acceptedTermsId },
      });
      return;
    }
    router.replace({
      pathname: "/add-funds/status",
      params: { status: "ONBOARDING", currency, provider, pending: "true", network },
    });
  } catch (error) {
    reportError(error);
    router.replace({
      pathname: "/add-funds/status",
      params: { status: "error", currency, provider, network },
    });
  }
}
