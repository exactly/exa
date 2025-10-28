import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, type Dispatch, type SetStateAction } from "react";

interface Step {
  id: string;
  title: string;
  completed: boolean;
}

const initialSteps: Step[] = [
  { id: "create-account", title: "Create account", completed: true },
  { id: "add-funds", title: "Add funds to account", completed: false },
  { id: "verify-identity", title: "Verify your identity", completed: false },
];

function useOnboardingSteps() {
  const queryClient = useQueryClient();
  const { data: steps } = useQuery<Step[]>({
    queryKey: ["onboarding", "steps"],
    queryFn: () => queryClient.getQueryData<Step[]>(["onboarding", "steps"]) ?? initialSteps,
    initialData: initialSteps,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const setSteps = useCallback<Dispatch<SetStateAction<Step[]>>>(
    (updater) => {
      queryClient.setQueryData<Step[]>(["onboarding", "steps"], (previousSteps) => {
        const baseSteps = previousSteps ?? initialSteps;
        const nextSteps =
          typeof updater === "function" ? (updater as (previous: Step[]) => Step[])(baseSteps) : updater;
        return nextSteps;
      });
    },
    [queryClient],
  );

  const currentStep = steps.find((step) => !step.completed);
  const completedSteps = steps.filter((step) => step.completed).length;

  return { steps, currentStep, completedSteps, setSteps };
}

export default useOnboardingSteps;
