import type { Credential } from "@exactly/common/validation";
import { useToastController } from "@tamagui/toast";
import { useMutation } from "@tanstack/react-query";
import { getAccount } from "@wagmi/core";
import { UserRejectedRequestError } from "viem";
import { useConnect } from "wagmi";

import alchemyConnector from "./alchemyConnector";
import queryClient, { type AuthMethod } from "./queryClient";
import reportError from "./reportError";
import { APIError, createCredential, getCredential } from "./server";
import ownerConfig, { getConnector as getOwnerConnector } from "./wagmi/owner";

export default function useAuth(onSuccess: (credential: Credential) => unknown, onDomainError: () => void) {
  const toast = useToastController();
  const { connectAsync: connectExa } = useConnect();
  const { connectAsync: connectOwner } = useConnect({ config: ownerConfig });
  const { mutate: signIn, ...mutation } = useMutation({
    mutationFn: async ({ method, register }: { method: AuthMethod; register?: boolean }) => {
      queryClient.setQueryData(["method"], method);
      if (method === "siwe" && getAccount(ownerConfig).isDisconnected) {
        await connectOwner({ connector: await getOwnerConnector() });
      }
      const credential = method === "siwe" || !register ? await getCredential() : await createCredential();
      queryClient.setQueryData<Credential>(["credential"], credential);
      await connectExa({ connector: alchemyConnector });
      return credential;
    },
    onSuccess,
    onError: (error: unknown) => {
      handleError(error, toast, onDomainError);
    },
  });
  return { signIn, ...mutation };
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
