import { useEffect } from "react";

import { useMutation } from "@tanstack/react-query";

import { cancelKYC, kycMutationOptions } from "./persona";

export default function useBeginKYC() {
  useEffect(() => cancelKYC, []);
  return useMutation(kycMutationOptions());
}
