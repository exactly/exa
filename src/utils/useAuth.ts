import type { Credential } from "@exactly/common/validation";
import { useToastController } from "@tamagui/toast";
import { useMutation } from "@tanstack/react-query";
import { UserRejectedRequestError } from "viem";

import queryClient from "./queryClient";
import reportError from "./reportError";
import { APIError, createCredential, getCredential } from "./server";

export default function useAuth(onSuccess: (credential: Credential) => void, onDomainError: () => void) {
  const toast = useToastController();

  const { mutate: createAccount, isPending: isCreateAccountPending } = useMutation({
    mutationFn: createCredential,
    onSuccess,
    onError: (error: unknown) => {
      handleAuthError(error, toast, onDomainError);
    },
  });

  const { mutate: recoverAccount, isPending: isRecoverAccountPending } = useMutation({
    mutationFn: getCredential,
    onSuccess,
    onError: (error: unknown) => {
      handleAuthError(error, toast, onDomainError);
    },
  });

  return { createAccount, isCreateAccountPending, recoverAccount, isRecoverAccountPending };
}

function handleAuthError(error: unknown, toast: ReturnType<typeof useToastController>, onDomainError: () => void) {
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
