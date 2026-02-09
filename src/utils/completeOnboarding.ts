import type { Router } from "expo-router";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { startRampOnboarding } from "./server";

export default async function completeOnboarding(
  router: Router,
  currency: string,
  provider: "bridge" | "manteca",
  acceptedTermsId?: string,
) {
  try {
    await startRampOnboarding(
      provider === "bridge" && acceptedTermsId ? { provider: "bridge", acceptedTermsId } : { provider: "manteca" },
    );
    queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
    router.replace({ pathname: "/add-funds/status", params: { status: "ONBOARDING", currency, provider } });
  } catch (error) {
    reportError(error);
    router.replace({ pathname: "/add-funds/status", params: { status: "error", currency, provider } });
  }
}
