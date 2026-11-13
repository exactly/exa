import { useState } from "react";
import { useTranslation } from "react-i18next";

import { toast } from "@tamagui/toast";

import { useMutation } from "@tanstack/react-query";
import { getConnection, switchChain } from "@wagmi/core";
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

export default function useAuth(onSuccess?: (credential: Credential) => unknown) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<SignInIssue>("domain");
  const [open, setOpen] = useState(false);
  const { mutateAsync: connectExa } = useConnect();
  const { mutateAsync: connectOwner } = useConnect({ config: ownerConfig });
  const { mutate: signIn, ...mutation } = useMutation({
    mutationFn: async ({ method, register }: { method: AuthMethod; register?: boolean }) => {
      queryClient.setQueryData(["method"], chain.id === base.id ? "siwe" : method);
      if (method === "siwe") {
        const connection = getConnection(ownerConfig);
        if (connection.isDisconnected || !connection.address) {
          await connectOwner({ connector: await getOwnerConnector(), chainId: chain.id });
        } else if (connection.chainId !== chain.id) {
          await switchChain(ownerConfig, { chainId: chain.id });
        }
      }
      const credential = method === "siwe" || !register ? await getCredential() : await createCredential();
      queryClient.setQueryData<Credential>(["credential"], credential);
      await connectExa({ connector: alchemyConnector });
      return credential;
    },
    onSuccess,
    onError: (error: unknown, { method, register }) => {
      handleError(
        error,
        (value) => {
          setIssue(value);
          setOpen(true);
        },
        t,
        method === "siwe" || !register,
      );
    },
  });
  return {
    signIn,
    dialog: {
      issue,
      open,
      onClose: () => {
        setOpen(false);
      },
      onRetry: () => {
        if (mutation.variables) signIn(mutation.variables);
      },
    },
    ...mutation,
  };
}

function handleError(error: unknown, onIssue: (issue: SignInIssue) => void, t: TFunction, auth: boolean) {
  if (
    error instanceof Error &&
    (("code" in error && error.code === "ERR_BIOMETRIC") || error.message.includes("Biometrics must be enabled"))
  ) {
    if (!auth) reportError(error);
    queryClient.setQueryData(["method"], undefined);
    onIssue("biometrics");
    return;
  }
  const { authKnown, bundleCancelled, passkeyCancelled, passkeyNotAllowed, walletRejected } = classifyError(error);
  if (authKnown) {
    const cancelled = bundleCancelled || passkeyCancelled || passkeyNotAllowed || walletRejected;
    if (!cancelled && !auth) reportError(error);
    queryClient.setQueryData(["method"], undefined);
    toast.error(t("Authentication cancelled"), { duration: 1000 });
    return;
  }
  if (error instanceof APIError && error.text === "backup eligibility required") {
    reportError(error, { level: "warning" });
    toast.error(t("Your password manager does not support passkey backups. Please try a different one"), {
      duration: 1000,
    });
    return;
  }
  if (
    error instanceof Error &&
    error.message.startsWith("The operation couldn’t be completed. Application with identifier")
  ) {
    onIssue("domain");
  } else if (error instanceof Error && error.message === "NoCredentials") {
    onIssue("passkey");
  } else {
    toast.error(t("Something went wrong. Please try again."), { duration: 1000 });
  }
  if (auth && queryClient.getQueryState(["auth"])?.error === error) return;
  reportError(error);
}

export type SignInIssue = "biometrics" | "domain" | "passkey";
