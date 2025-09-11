import type { Credential } from "@exactly/common/validation";
import { useToastController } from "@tamagui/toast";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { UserRejectedRequestError } from "viem";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { APIError, createCredential, getCredential } from "./server";

export default function useAuth(onSuccess: (credential: Credential) => void, onDomainError: () => void) {
  const toast = useToastController();
  const { mutate: register, isPending: isRegisterPending } = useMutation({
    mutationFn: createCredential,
    onSuccess,
    onError: (error: unknown) => {
      handleError(error, toast, onDomainError);
    },
  });
  const { mutate: authenticate, isPending: isAuthenticatePending } = useMutation({
    mutationFn: getCredential,
    onSuccess,
    onError: (error: unknown) => {
      handleError(error, toast, onDomainError);
    },
  });
  const handleAuth = useCallback(
    (registration?: boolean) => {
      const method = queryClient.getQueryData(["method"]);
      switch (method) {
        case "siwe":
          authenticate();
          break;
        case "webauthn":
          if (registration) register();
          else authenticate();
          break;
        default:
          throw new Error("bad method");
      }
    },
    [authenticate, register],
  );
  const loading = useMemo(() => isRegisterPending || isAuthenticatePending, [isRegisterPending, isAuthenticatePending]);
  return { handleAuth, loading };
}

function handleError(error: unknown, toast: ReturnType<typeof useToastController>, onDomainError: () => void) {
  if (
    (error instanceof Error &&
      (error.message ===
        "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)" ||
        error.message === "The operation couldn’t be completed. Device must be unlocked to perform request." ||
        error.message === "UserCancelled" ||
        error.message.startsWith("androidx.credentials.exceptions.domerrors.NotAllowedError") ||
        error.message === "invalid operation" ||
        error.name === "NotAllowedError")) ||
    error instanceof UserRejectedRequestError
  ) {
    queryClient.setQueryData(["method"], undefined);
    toast.show("Authentication cancelled", {
      native: true,
      duration: 1000,
      burntOptions: { haptic: "error", preset: "error" },
    });
    return;
  }
  if (error instanceof APIError && error.text === "backup eligibility required") {
    toast.show("Your password manager does not support passkey backups. Please try a different one", {
      native: true,
      duration: 1000,
      burntOptions: { haptic: "error", preset: "error" },
    });
    return;
  }
  if (
    error instanceof Error &&
    error.message.startsWith("The operation couldn’t be completed. Application with identifier")
  ) {
    onDomainError();
  }
  reportError(error);
}
