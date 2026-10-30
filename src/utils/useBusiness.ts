import { useQuery } from "@tanstack/react-query";
import { boolean, nullish, object, safeParse, string } from "valibot";

import business from "@exactly/common/business";

import { getRampProviders, origin, type KYCStatus } from "./server";

import type { InferOutput } from "valibot";

export default function useBusiness(poll = false) {
  const redirectURL = `${origin}/business`;
  const profile = useQuery<KYCStatus>({
    queryKey: ["kyc", "status"],
    enabled: business,
    refetchInterval: (query) => (poll && waiting(profileStep(query.state.data)) ? 30_000 : false),
  });
  const application = useQuery<KYCStatus>({
    queryKey: ["kyc", "panda-business"],
    enabled: business,
    refetchInterval: (query) => {
      const state = safeParse(KYB, query.state.data);
      return poll && waiting(cardStep(state.success ? state.output : undefined)) ? 30_000 : false;
    },
  });
  const providers = useQuery({
    queryKey: ["ramp", "providers", redirectURL],
    queryFn: () => getRampProviders(undefined, redirectURL),
    enabled: business,
    refetchInterval: (query) => (poll && waiting(transfersStep(query.state.data?.bridge)) ? 30_000 : false),
  });
  const kyb = safeParse(KYB, application.data);
  const status = business ? profile.data : undefined;
  const locked = profileStep(status) !== "completed";
  const card = cardStep(kyb.success ? kyb.output : undefined);
  const approved = kyb.success && approvedCompany(kyb.output);
  const transfers = transfersStep(providers.data?.bridge);
  const tasks = [
    { id: "profile" as const, step: profileStep(status) },
    { id: "card" as const, step: card },
    { id: "transfers" as const, step: transfers },
  ];
  return {
    redirectURL,
    refetchTransfers: providers.refetch,
    profile: profileStep(status),
    card,
    cardLink: approved ? undefined : kybLink(application.data),
    approved,
    transfers,
    tosLink:
      providers.data?.bridge.status === "NOT_STARTED" && "tosLink" in providers.data.bridge
        ? providers.data.bridge.tosLink
        : undefined,
    kycLink:
      providers.data?.bridge.status === "ONBOARDING" && "kycLink" in providers.data.bridge
        ? providers.data.bridge.kycLink
        : undefined,
    locked,
    current: (["action", "failed", "unavailable", "review", "pending"] as const)
      .flatMap((step) =>
        tasks
          .filter((task) => task.step === step && (task.id === "profile" || !locked))
          .map(({ id }) => ({ id, step })),
      )
      .at(0),
  };
}

const Link = object({ params: object({ signature: string(), userId: string() }), url: string() });

const KYB = object({
  approved: nullish(boolean()),
  code: string(),
  completionLink: nullish(Link),
  status: nullish(string()),
  verificationLink: nullish(Link),
});

export function kybLink(payload: unknown) {
  const kyb = safeParse(KYB, payload);
  if (!kyb.success) return;
  const link = kyb.output.verificationLink ?? kyb.output.completionLink;
  return link && `${link.url}?${String(new URLSearchParams(link.params))}`;
}

export type Step = "action" | "completed" | "failed" | "pending" | "review" | "unavailable";

const waiting = (step?: Step) => step === "action" || step === "review";

function profileStep(status?: KYCStatus): Step | undefined {
  switch (status && "code" in status ? status.code : undefined) {
    case "ok":
      return "completed";
    case "not started":
      return "pending";
    case "processing":
      return "review";
    case "bad kyc":
      return "failed";
    case "not supported":
      return "unavailable";
  }
}

function approvedCompany(application: InferOutput<typeof KYB>) {
  return (
    !!application.approved ||
    application.code === "ok" ||
    application.code === "bad kyc" ||
    (application.code === "processing" && !application.status)
  );
}

function cardStep(application?: InferOutput<typeof KYB>): Step | undefined {
  if (!application) return;
  if (application.code === "ok") return "completed";
  if (application.code === "not started") return "pending";
  if (application.code === "bad kyb" || application.code === "bad kyc") return "failed";
  if (application.code === "processing" && !application.status) return "review";
  switch (application.status) {
    case "approved":
      return "completed";
    case "needsInformation":
    case "needsVerification":
    case "notStarted":
      return "action";
    case "manualReview":
    case "pending":
    case "unknown":
      return "review";
    case "canceled":
    case "denied":
    case "locked":
      return "failed";
  }
}

function transfersStep(bridge?: { kycLink?: string; status: string }): Step | undefined {
  switch (bridge?.status) {
    case "NOT_STARTED":
      return "pending";
    case "ONBOARDING":
      return bridge.kycLink ? "action" : "review";
    case "ACTIVE":
      return "completed";
    case "CONTACT_SUPPORT":
      return "failed";
    case "NOT_AVAILABLE":
      return "unavailable";
  }
}
