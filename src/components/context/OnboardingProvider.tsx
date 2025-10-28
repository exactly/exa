import type { ReactNode } from "react";
import React, { createContext, useState } from "react";

interface Step {
  id: string;
  title: string;
  completed: boolean;
}

interface OnboardingContextProperties {
  steps: Step[];
  currentStep?: Step;
  completedSteps: number;
  setSteps: React.Dispatch<React.SetStateAction<Step[]>>;
}

const OnboardingContext = createContext<OnboardingContextProperties>({
  steps: [],
  currentStep: undefined,
  completedSteps: 0,
  setSteps: () => undefined,
});

function OnboardingProvider({ children }: { children: ReactNode }) {
  const [steps, setSteps] = useState([
    { id: "create-account", title: "Create account", completed: true },
    { id: "add-funds", title: "Add funds to account", completed: false },
    { id: "verify-identity", title: "Verify your identity", completed: false },
  ]);

  const currentStep = steps.find((step) => !step.completed);
  const completedSteps = steps.filter((step) => step.completed).length;

  return (
    <OnboardingContext.Provider value={{ steps, currentStep, completedSteps, setSteps }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export { OnboardingProvider, OnboardingContext };
