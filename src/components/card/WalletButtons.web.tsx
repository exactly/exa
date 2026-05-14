import React from "react";
import { useTranslation } from "react-i18next";

import { useQuery } from "@tanstack/react-query";

import DismissableAlert from "./DismissableAlert";
import queryClient from "../../utils/queryClient";

// eslint-disable-next-line @eslint-react/no-unused-props -- prop parity with native .tsx variant
export default function WalletButtons(_: { displayName: string; lastFour: string }) {
  const { t } = useTranslation();
  const { data: alertShown } = useQuery({ queryKey: ["settings", "alertShown"] });
  if (!alertShown) return null;
  return (
    <DismissableAlert
      text={t("Manually add your card to Apple Pay & Google Pay to make contactless payments.")}
      onDismiss={() => {
        queryClient.setQueryData(["settings", "alertShown"], false);
      }}
    />
  );
}
