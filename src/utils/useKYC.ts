import { useQuery } from "@tanstack/react-query";

import type { KYCStatus } from "./server";

export default function useKYC(enabled = true) {
  const { data, error, isFetched, isFetching, refetch } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"], enabled });
  const code = data && "code" in data ? data.code : undefined;
  const approved = code === "ok" || code === "legacy kyc";
  const status: KYCState = approved
    ? "approved"
    : code === "processing"
      ? "review"
      : code === "bad kyc"
        ? "failed"
        : "pending";
  return {
    approved,
    status,
    legacy: code === "legacy kyc",
    review: code === "processing",
    failed: code === "bad kyc",
    unverified: code === "not started" || code === "no kyc",
    error,
    isFetched,
    isFetching,
    refetch,
  };
}

export type KYCState = "approved" | "failed" | "pending" | "review";
