import { useTranslation } from "react-i18next";

import { useToastController } from "@tamagui/toast";

import { useQuery } from "@tanstack/react-query";

import { newMessage } from "./intercom";
import { startCardLimitKYC } from "./persona";
import reportError from "./reportError";

import type { KYCStatus } from "./server";

export default function useCardLimit(enabled: boolean) {
  const { t } = useTranslation();
  const toast = useToastController();
  const { data: status, isPending } = useQuery<KYCStatus>({ queryKey: ["kyc", "cardLimit"], enabled });
  function increase() {
    if (status?.code !== "not started") {
      newMessage(t("I want to increase my spending limit")).catch(reportError);
      return;
    }
    startCardLimitKYC()
      .catch((error: unknown) => {
        reportError(error);
        return { status: "error" } as const;
      })
      .then((result) => {
        if (result.status === "error")
          toast.show(t("Something went wrong. Please try again."), {
            burntOptions: { haptic: "error", preset: "error" },
          });
      })
      .catch(reportError);
  }
  return { increase, pending: isPending, processing: status?.code === "processing" };
}
