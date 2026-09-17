import React from "react";
import { useTranslation } from "react-i18next";

import Banner from "./Banner";
import Skeleton from "../shared/Skeleton";

import type { Step } from "../../utils/useBusiness";

export default function Transfers({ step, onPress }: { onPress: () => void; step?: Step }) {
  const { t } = useTranslation();
  if (step === undefined) return <Skeleton width="100%" height={82} />;
  if (step !== "pending" && step !== "review" && step !== "action") return null;
  return (
    <Banner
      step={step}
      title={t("Enable USD and EUR bank transfers")}
      description={
        step === "pending"
          ? t("Verify your business")
          : step === "review"
            ? t("Review takes 3 to 5 business days.")
            : t("We need more information before we can continue.")
      }
      onPress={onPress}
    />
  );
}
