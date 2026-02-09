import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import AddFundsOption from "./AddFundsOption";
import { currencies } from "../../utils/currencies";
import Text from "../shared/Text";

type AddFiatButtonProperties = {
  currency: string;
  provider: string;
  status: "ACTIVE" | "NOT_AVAILABLE" | "NOT_STARTED" | "ONBOARDING";
};

export default function AddFiatButton({ currency, provider, status }: AddFiatButtonProperties) {
  const { t } = useTranslation();
  const router = useRouter();

  const emoji = currency in currencies ? currencies[currency as keyof typeof currencies].emoji : "💰";

  if (status === "NOT_AVAILABLE") {
    return null;
  }

  function handlePress() {
    switch (status) {
      case "NOT_STARTED":
        router.push({ pathname: "/add-funds/onboard", params: { currency, provider } });
        break;

      case "ONBOARDING":
        router.push({ pathname: "/add-funds/status", params: { status: "ONBOARDING", currency, provider } });
        break;

      case "ACTIVE":
        router.push({ pathname: "/add-funds/ramp", params: { currency, provider } });
        break;
    }
  }

  return (
    <AddFundsOption
      icon={<Text>{emoji}</Text>}
      title={currency}
      subtitle={t("The bank account must be in your name")}
      onPress={handlePress}
    />
  );
}
