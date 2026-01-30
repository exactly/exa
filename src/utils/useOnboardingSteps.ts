import { useMemo } from "react";

type Step = { completed: boolean; id: string; title: string };

export default function useOnboardingSteps({ hasKYC, isDeployed }: { hasKYC: boolean; isDeployed: boolean }) {
  return useMemo(() => {
    const steps: Step[] = [
      { id: "create-account", title: "Create account", completed: true },
      { id: "add-funds", title: "Add funds to account", completed: isDeployed },
      { id: "verify-identity", title: "Verify your identity", completed: hasKYC },
    ];
    const currentStep = steps.find((step) => !step.completed);
    const completedSteps = steps.filter((step) => step.completed).length;
    return { steps, currentStep, completedSteps };
  }, [hasKYC, isDeployed]);
}
