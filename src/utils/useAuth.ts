import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Linking, Platform } from "react-native";

import { toast } from "@tamagui/toast";

import { useMutation } from "@tanstack/react-query";
import { getConnection, switchChain } from "@wagmi/core";
import { base } from "viem/chains";
import { useConnect } from "wagmi";

import chain from "@exactly/common/generated/chain";
import tenants from "@exactly/common/tenants";

import alchemyConnector from "./alchemyConnector";
import queryClient, { type AuthMethod } from "./queryClient";
import reportError, { classifyError } from "./reportError";
import { track } from "./segment";
import { APIError, createCredential, getCredential, isUnlinked, origin } from "./server";
import ownerConfig, { getConnector as getOwnerConnector } from "./wagmi/owner";

import type { Credential } from "@exactly/common/validation";
import type { TFunction } from "i18next";

export default function useAuth(onSuccess?: (credential: Credential) => unknown) {
  const { t } = useTranslation();
  const [issue, setIssue] = useState<SignInIssue>("domain");
  const [open, setOpen] = useState(false);
  const [hybrid, setHybrid] = useState(false);
  const [brand, setBrand] = useState<string>();
  const cancelProvidersRef = useRef<() => void>(undefined);
  useEffect(() => () => cancelProvidersRef.current?.(), []);
  const { mutateAsync: connectExa } = useConnect();
  const { mutateAsync: connectOwner } = useConnect({ config: ownerConfig });
  const { mutate: signIn, ...mutation } = useMutation({
    mutationFn: async ({ method, register, hints }: { hints?: string[]; method: AuthMethod; register?: boolean }) => {
      queryClient.setQueryData(["method"], isPasskeyEnabled ? method : "siwe");
      if (method === "siwe") {
        const connection = getConnection(ownerConfig);
        if (connection.isDisconnected || !connection.address) {
          await connectOwner({ connector: await getOwnerConnector(), chainId: chain.id });
        } else if (connection.chainId !== chain.id) {
          await switchChain(ownerConfig, { chainId: chain.id });
        }
      }
      const credential = method === "siwe" || !register ? await getCredential() : await createCredential(hints);
      queryClient.setQueryData<Credential>(["credential"], credential);
      await connectExa({ connector: alchemyConnector });
      return credential;
    },
    onMutate: () => {
      cancelProvidersRef.current?.();
    },
    onSuccess,
    onError: (error: unknown, { method, register }) => {
      handleError(
        error,
        (value) => {
          setIssue(value);
          setHybrid(value === "backup" && hybridTransport);
          setBrand(value === "backup" ? brands[aaguid(error) ?? ""] : undefined);
          setOpen(true);
        },
        t,
        method === "siwe" || !register,
      );
    },
  });
  function retry(settings = false) {
    cancelProvidersRef.current?.();
    if (!mutation.variables) return;
    if (issue === "backup") track("Passkey Backup Retried", { hybrid, settings });
    signIn({ ...mutation.variables, hints: hybrid ? ["hybrid"] : undefined });
  }
  return {
    signIn,
    dialog: {
      issue,
      open,
      hybrid,
      brand,
      onClose: () => {
        setOpen(false);
      },
      onRetry: () => {
        retry();
      },
      onProviders: () => {
        cancelProvidersRef.current?.();
        let left = false;
        const subscription = AppState.addEventListener("change", (state) => {
          if (state === "background") left = true;
          else if (state === "active" && left) retry(true);
        });
        function cancel() {
          subscription.remove();
          if (cancelProvidersRef.current !== cancel) return;
          cancelProvidersRef.current = undefined;
          queryClient.setQueryData(["provider-choice"], false);
        }
        cancelProvidersRef.current = cancel;
        queryClient.setQueryData(["provider-choice"], true);
        Linking.sendIntent("android.settings.SYNC_SETTINGS").catch((error: unknown) => {
          if (cancelProvidersRef.current !== cancel) return;
          reportError(error);
          retry();
        });
      },
    },
    ...mutation,
  };
}

export const isPasskeyEnabled = chain.id !== base.id || Object.hasOwn(tenants, origin);

function handleError(error: unknown, onIssue: (issue: SignInIssue) => void, t: TFunction, auth: boolean) {
  const passkey =
    error instanceof Error
      ? ("code" in error && error.code === "ERR_BIOMETRIC") || error.message.includes("Biometrics must be enabled")
        ? "biometrics"
        : error.message.includes("Stolen Device Protection is enabled")
          ? "stolen"
          : ("code" in error && error.code === "ERR_PENDING_PASSKEY_REQUEST") ||
              error.message.includes("There is already a pending passkey request")
            ? "pending"
            : undefined
      : undefined;
  if (passkey) {
    if (!auth) reportError(error);
    queryClient.setQueryData(["method"], undefined);
    onIssue(passkey);
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
    track("Passkey Backup Rejected", { aaguid: aaguid(error) });
    onIssue("backup");
    return;
  }
  if (
    error instanceof Error &&
    error.message.startsWith("The operation couldn’t be completed. Application with identifier")
  ) {
    onIssue("domain");
  } else if (error instanceof Error && error.message === "NoCredentials") {
    onIssue("passkey");
  } else if (isUnlinked(error)) {
    onIssue("unlinked");
  } else if (error instanceof APIError && error.text === "other tenant") {
    onIssue("tenant");
    return;
  } else if (error instanceof APIError && error.text === "no authentication") {
    toast.error(t("Sign-in timed out. Please try again."), { duration: 1000 });
  } else {
    toast.error(t("Something went wrong. Please try again."), { duration: 1000 });
  }
  if (auth && queryClient.getQueryState(["auth"])?.error === error) return;
  reportError(error);
}

export type SignInIssue = "backup" | "biometrics" | "domain" | "passkey" | "pending" | "stolen" | "tenant" | "unlinked";

const brands: Record<string, string> = {
  "584d4354-4150-2d30-3030-303030303032": "Xiaomi",
  "7669766f-7061-7373-6b65-796775696430": "vivo",
};

function aaguid(error: unknown) {
  return error instanceof APIError && "aaguid" in error && typeof error.aaguid === "string" ? error.aaguid : undefined;
}

let hybridTransport = false;
if (
  Platform.OS === "web" &&
  typeof PublicKeyCredential !== "undefined" &&
  "getClientCapabilities" in PublicKeyCredential &&
  (navigator as { userAgentData?: { mobile: boolean } }).userAgentData?.mobile === false
) {
  PublicKeyCredential.getClientCapabilities()
    .then(({ hybridTransport: available }) => {
      hybridTransport = available === true;
    })
    .catch(reportError);
}
