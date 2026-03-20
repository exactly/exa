import { useTranslation } from "react-i18next";

import { useToastController } from "@tamagui/toast";

import { useQuery } from "@tanstack/react-query";
import { isAfter, subDays } from "date-fns";

import { newMessage } from "./intercom";
import { startCardLimitKYC } from "./persona";
import reportError from "./reportError";

import type { CardActivity, KYCStatus } from "./server";

export default function useCardLimit(amount?: number, open = false) {
  const { t } = useTranslation();
  const toast = useToastController();
  const { data: spent = 0 } = useQuery<CardActivity[], Error, number>({
    queryKey: ["activity", "card"],
    select: selectSpending,
  });
  const limit = amount ? amount / 100 : undefined;
  const usage = limit ? spent / limit : 0;
  const { data: status, isPending } = useQuery<KYCStatus>({
    queryKey: ["kyc", "cardLimit"],
    enabled: open || usage >= 0.9,
  });
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
  return { increase, limit, spent, usage, pending: isPending, processing: status?.code === "processing" };
}

function selectSpending(activity: CardActivity[]) {
  const since = subDays(new Date(), 7);
  return activity.reduce(
    (total, item) =>
      item.type === "panda" && item.status !== "declined" && isAfter(new Date(item.timestamp), since)
        ? total + item.usdAmount
        : total,
    0,
  );
}
