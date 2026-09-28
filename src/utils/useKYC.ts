import { useQuery } from "@tanstack/react-query";

import type { KYCStatus } from "./server";

export default function useKYC(enabled = true) {
  const { data, error, isFetched, isFetching, refetch } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"], enabled });
  const code = data && "code" in data ? data.code : undefined;
  const approved = code === "ok" || code === "legacy kyc";
  return {
    approved,
    status: approved ? "approved" : code === "processing" ? "review" : code === "bad kyc" ? "failed" : "pending",
    legacy: code === "legacy kyc",
    review: code === "processing",
    failed: code === "bad kyc",
    unverified: code === "not started" || code === "no kyc",
    error,
    isFetched,
    isFetching,
    refetch,
  } as const;
}

export type KYCState = ReturnType<typeof useKYC>["status"];
