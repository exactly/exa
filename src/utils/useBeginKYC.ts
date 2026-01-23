import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { useToastController } from "@tamagui/toast";

import { useMutation } from "@tanstack/react-query";

import { cancelKYC, startKYC } from "./persona";
import queryClient from "./queryClient";
import reportError from "./reportError";
import { APIError, getKYCStatus } from "./server";

export default function useBeginKYC() {
  const toast = useToastController();
  const { t } = useTranslation();

  useEffect(() => cancelKYC, []);

  return useMutation({
    mutationKey: ["kyc"],
    async mutationFn() {
      try {
        const status = await getKYCStatus();
        if ("code" in status && (status.code === "ok" || status.code === "legacy kyc")) return;
      } catch (error) {
        if (!(error instanceof APIError)) throw error;
        if (error.text !== "not started" && error.text !== "no kyc") throw error;
      }
      await startKYC();
    },
    async onSettled() {
      await queryClient.invalidateQueries({ queryKey: ["kyc", "status"] });
    },
    onError(error) {
      toast.show(t("Error verifying identity"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
      reportError(error);
    },
  });
}
