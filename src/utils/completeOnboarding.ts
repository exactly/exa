import type { Router } from "expo-router";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { startRampOnboarding } from "./server";

export default async function completeOnboarding(router: Router, currency: string) {
  try {
    const result = await startRampOnboarding({ provider: "manteca" });
    queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
    if ("inquiryId" in result) {
      queryClient.setQueryData(["ramp", "invalid-legal-id"], {
        inquiryId: result.inquiryId,
        sessionToken: result.sessionToken,
      });
      router.replace({ pathname: "/add-funds/kyc", params: { currency } });
      return;
    }
    router.replace({ pathname: "/add-funds/status", params: { status: "ONBOARDING", currency, pending: "true" } });
  } catch (error) {
    reportError(error);
    router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
  }
}
