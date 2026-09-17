import { useQuery } from "@tanstack/react-query";

import business from "@exactly/common/business";
import domain from "@exactly/common/domain";

import { APIError } from "./queryClient";
import { getRampProviders, type getApplication, type KYCStatus } from "./server";

export default function useBusiness(poll = false) {
  const redirectURL = `https://${domain}/business`;
  const profile = useQuery<KYCStatus>({
    queryKey: ["kyc", "status"],
    enabled: business,
    refetchInterval: (query) => (poll && waiting(profileStep(query.state.data)) ? 30_000 : false),
  });
  const application = useQuery<Awaited<ReturnType<typeof getApplication>>>({
    queryKey: ["kyc", "application"],
    enabled: business,
    refetchInterval: (query) => (poll && waiting(cardStep(query.state.data?.status)) ? 30_000 : false),
  });
  const providers = useQuery({
    queryKey: ["ramp", "providers", redirectURL],
    queryFn: () => getRampProviders(undefined, redirectURL),
    enabled: business,
    refetchInterval: (query) => (poll && waiting(transfersStep(query.state.data?.bridge.status)) ? 30_000 : false),
  });
  const card = cardStep(application.data?.status ?? code(application.error));
  const transfers = transfersStep(providers.data?.bridge.status);
  const tasks = [
    { id: "card" as const, step: card },
    { id: "transfers" as const, step: transfers },
  ];
  return {
    profile: profileStep(profile.data),
    card,
    reason: application.data?.reason === "unknown" ? undefined : application.data?.reason,
    transfers,
    current: (["action", "review", "pending"] as const)
      .flatMap((step) => tasks.filter((task) => task.step === step).map(({ id }) => ({ id, step })))
      .at(0),
  };
}

export type Step = "action" | "completed" | "failed" | "pending" | "review" | "unavailable";

const waiting = (step?: Step) => step === "action" || step === "review";

function code(error: Error | null) {
  return error instanceof APIError && error.code === 400 ? error.text : undefined;
}

function profileStep(status?: KYCStatus): Step | undefined {
  switch (status && "code" in status ? status.code : undefined) {
    case "ok":
    case "legacy kyc":
      return "completed";
    case "no kyc":
    case "not started":
      return "pending";
    case "processing":
      return "review";
    case "bad kyc":
      return "failed";
  }
}

function cardStep(status?: string): Step | undefined {
  switch (status) {
    case "not started":
    case "notStarted":
      return "pending";
    case "needsInformation":
    case "needsVerification":
      return "action";
    case "pending":
    case "manualReview":
    case "unknown":
      return "review";
    case "approved":
      return "completed";
    case "denied":
    case "locked":
    case "canceled":
      return "failed";
  }
}

function transfersStep(status?: string): Step | undefined {
  switch (status) {
    case "NOT_STARTED":
      return "pending";
    case "ONBOARDING":
      return "action";
    case "ACTIVE":
      return "completed";
    case "CONTACT_SUPPORT":
      return "failed";
    case "NOT_AVAILABLE":
      return "unavailable";
  }
}
