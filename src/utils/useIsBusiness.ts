import { useQuery } from "@tanstack/react-query";
import { isAddressEqual } from "viem";

import host from "@exactly/common/business";
import { business } from "@exactly/common/tenants";

import queryClient from "./queryClient";

import type { Credential } from "@exactly/common/validation";

export function isBusiness(credential = queryClient.getQueryData<Credential>(["credential"])) {
  if (!credential) return host;
  return !!credential.salt && isAddressEqual(credential.salt, business);
}

export default function useIsBusiness() {
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  return isBusiness(credential);
}
