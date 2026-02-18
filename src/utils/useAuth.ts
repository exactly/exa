import { useTranslation } from "react-i18next";

import { useToastController } from "@tamagui/toast";

import { useMutation } from "@tanstack/react-query";
import { getConnection } from "@wagmi/core";
import { UserRejectedRequestError } from "viem";
import { base } from "viem/chains";
import { useConnect } from "wagmi";

import chain from "@exactly/common/generated/chain";

import alchemyConnector from "./alchemyConnector";
import queryClient, { type AuthMethod } from "./queryClient";
import reportError, { classifyError } from "./reportError";
import { APIError, createCredential, getCredential } from "./server";
import ownerConfig, { getConnector as getOwnerConnector } from "./wagmi/owner";

import type { Credential } from "@exactly/common/validation";
import type { TFunction } from "i18next";

export default function useAuth(onDomainError: () => void, onSuccess?: (credential: Credential) => unknown) {
  const { t } = useTranslation();
  const toast = useToastController();
  const { mutateAsync: connectExa } = useConnect();
  const { mutateAsync: connectOwner } = useConnect({ config: ownerConfig });
  const { mutate: signIn, ...mutation } = useMutation({
    mutationFn: async ({ method, register }: { method: AuthMethod; register?: boolean }) => {
      queryClient.setQueryData(["method"], chain.id === base.id ? "siwe" : method);
      if (method === "siwe" && getConnection(ownerConfig).isDisconnected) {
        await connectOwner({ connector: await getOwnerConnector() });
      }
      const credential = method === "siwe" || !register ? await getCredential() : await createCredential();
      queryClient.setQueryData<Credential>(["credential"], credential);
      await connectExa({ connector: alchemyConnector });
      return credential;
    },
    onSuccess,
    onError: (error: unknown, { method, register }) => {
      handleError(error, toast, onDomainError, t, method === "siwe" || !register);
    },
  });
  return { signIn, ...mutation };
}

function handleError(
  error: unknown,
  toast: ReturnType<typeof useToastController>,
  onDomainError: () => void,
  t: TFunction,
  auth: boolean,
) {
  if (
    error instanceof Error &&
    (("code" in error && error.code === "ERR_BIOMETRIC") || error.message.includes("Biometrics must be enabled"))
  ) {
    if (!auth) reportError(error);
    queryClient.setQueryData(["method"], undefined);
    toast.show(t("Biometrics must be enabled to use passkeys. Please enable biometrics in your device settings"), {
      native: true,
      duration: 3000,
      burntOptions: { haptic: "error", preset: "error" },
    });
    return;
  }
  const { authKnown, passkeyCancelled, passkeyNotAllowed } = classifyError(error);
  if (authKnown || error instanceof UserRejectedRequestError) {
    const cancelled = passkeyCancelled || passkeyNotAllowed || error instanceof UserRejectedRequestError;
    if (!cancelled && !auth) reportError(error);
    queryClient.setQueryData(["method"], undefined);
    toast.show(t("Authentication cancelled"), {
      native: true,
      duration: 1000,
      burntOptions: { haptic: "error", preset: "error" },
    });
    return;
  }
  if (error instanceof APIError && error.text === "backup eligibility required") {
    reportError(error, { level: "warning" });
    toast.show(t("Your password manager does not support passkey backups. Please try a different one"), {
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
  if (auth && queryClient.getQueryState(["auth"])?.error === error) return;
  reportError(error);
}
