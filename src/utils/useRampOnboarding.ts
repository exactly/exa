import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { useLocalSearchParams, useRouter } from "expo-router";

import { useToastController } from "@tamagui/toast";

import { useMutation, useQuery } from "@tanstack/react-query";

import domain from "@exactly/common/domain";

import completeOnboarding from "./completeOnboarding";
import { APIError } from "./queryClient";
import reportError from "./reportError";
import { getKYCStatus, getRampProviders } from "./server";

export default function useRampOnboarding(direction: "offramp" | "onramp" = "onramp") {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const { currency, network, provider } = useLocalSearchParams();
  const offramp = direction === "offramp";
  const isBridge = provider === "bridge";
  const isManteca = !offramp && provider === "manteca";
  const [tosLink, setTOSLink] = useState<string>();

  const { data: countryCode } = useQuery<string>({ queryKey: ["user", "country"] });
  const redirectURL = `https://${domain}/${offramp ? "send-funds" : "add-funds"}`;

  const { data: providers } = useQuery({
    queryKey: ["ramp", "providers", countryCode, redirectURL],
    queryFn: () => getRampProviders(countryCode, redirectURL),
    enabled: isBridge && !!countryCode,
    staleTime: 60_000,
  });
  const bridge = providers?.bridge;
  const providerTOSLink = bridge && "tosLink" in bridge ? bridge.tosLink : undefined;

  const { mutateAsync: handleBridgeOnboarding, isPending: isBridgePending } = useMutation({
    mutationKey: ["ramp", "onboarding", "bridge"],
    mutationFn: async (signedAgreementId: string) => {
      if (typeof currency !== "string" || !currency) return;
      return await completeOnboarding(
        router,
        currency,
        "bridge",
        signedAgreementId,
        typeof network === "string" ? network : undefined,
        direction,
      );
    },
  });

  const { mutateAsync: handleMantecaOnboarding, isPending: isMantecaPending } = useMutation({
    mutationKey: ["ramp", "onboarding", "manteca"],
    async mutationFn() {
      if (typeof currency !== "string" || !currency) return;
      const status = await getKYCStatus("manteca").catch((error: unknown) => {
        if (error instanceof APIError) return { code: error.text };
        throw error;
      });
      const kycCode = "code" in status && typeof status.code === "string" ? status.code : "not started";

      if (kycCode === "not started") {
        router.replace({
          pathname: offramp ? "/send-funds/kyc" : "/add-funds/kyc",
          params: { currency, provider, direction },
        });
        return;
      }

      if (kycCode === "ok") {
        await completeOnboarding(router, currency, "manteca", undefined, undefined, direction);
        return;
      }

      router.replace({
        pathname: offramp ? "/send-funds/status" : "/add-funds/status",
        params: { status: "error", currency, provider, direction },
      });
    },
  });

  const isPending = isBridgePending || isMantecaPending;

  const handleTOSRedirect = useCallback(
    (url: string) => {
      let signedAgreementId: string | undefined;
      try {
        signedAgreementId = new URL(url).searchParams.get("signed_agreement_id") ?? undefined;
      } catch {} // eslint-disable-line no-empty
      if (!signedAgreementId) {
        toast.show(t("Something went wrong. Please try again."), {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error" },
        });
        return;
      }
      handleBridgeOnboarding(signedAgreementId).catch(reportError);
    },
    [handleBridgeOnboarding, t, toast],
  );

  const handleContinue = useCallback(async () => {
    if (isBridge) {
      if (!providerTOSLink) return;
      setTOSLink(providerTOSLink);
      return;
    }
    if (isManteca) await handleMantecaOnboarding();
  }, [handleMantecaOnboarding, isBridge, isManteca, providerTOSLink]);

  return { handleContinue, handleTOSRedirect, isPending, providerTOSLink, redirectURL, setTOSLink, tosLink };
}
