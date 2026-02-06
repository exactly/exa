import type { Router } from "expo-router";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { startRampOnboarding } from "./server";

export default async function completeOnboarding(router: Router, currency: string) {
  try {
    await startRampOnboarding({ provider: "manteca" });
    queryClient.invalidateQueries({ queryKey: ["ramp", "providers"] }).catch(reportError);
    router.replace({ pathname: "/add-funds/status", params: { status: "ONBOARDING", currency } });
  } catch (error) {
    reportError(error);
    router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
  }
}
