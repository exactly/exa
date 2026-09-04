import { useMemo } from "react";

import type { KYCState } from "./useKYC";

export default function useOnboardingSteps({ kyc, isDeployed }: { isDeployed: boolean; kyc: KYCState }) {
  return useMemo(() => {
    const steps = [
      { id: "create-account", status: "completed", title: "Account created" },
      {
        id: "verify-identity",
        status: kyc === "approved" ? "completed" : kyc,
        title: kyc === "approved" ? "Identity verified" : "Verify your identity",
      },
      {
        id: "add-funds",
        status: isDeployed ? "completed" : "pending",
        title: isDeployed ? "Funds added" : "Add funds to your account",
      },
    ] as const;
    return [...steps].sort((a, b) => precedence[a.status] - precedence[b.status]);
  }, [kyc, isDeployed]);
}

const precedence = { pending: 0, review: 1, failed: 1, completed: 2 };
