import type { Router } from "expo-router";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { getKYCStatus, getRampProviders, startRampOnboarding } from "./server";

export default async function completeOnboarding(router: Router, currency: string) {
  try {
    await startRampOnboarding({ provider: "manteca" });

    let countryCode = queryClient.getQueryData<string>(["user", "country"]);
    if (!countryCode) {
      await getKYCStatus("basic", true);
      countryCode = queryClient.getQueryData<string>(["user", "country"]);
    }

    const providers = await queryClient.fetchQuery({
      queryKey: ["ramp", "providers", countryCode],
      queryFn: () => getRampProviders(countryCode),
      staleTime: 0,
    });

    const newStatus = providers.manteca.status;
    if (newStatus === "ACTIVE") {
      router.replace({ pathname: "/add-funds/ramp", params: { currency } });
    } else if (newStatus === "ONBOARDING") {
      router.replace({ pathname: "/add-funds/status", params: { status: newStatus, currency } });
    } else {
      router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
    }
  } catch (error) {
    reportError(error);
    router.replace({ pathname: "/add-funds/status", params: { status: "error", currency } });
  }
}
