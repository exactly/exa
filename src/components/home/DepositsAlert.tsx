import React from "react";
import { useTranslation } from "react-i18next";

import { useIsFetching } from "@tanstack/react-query";

import { chains } from "@exactly/common/generated/chain";

import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import InfoAlert from "../shared/InfoAlert";

import type { Query } from "@tanstack/react-query";

export default function DepositsAlert({ failed }: { failed: number[] }) {
  const { t } = useTranslation();
  const predicate = ({ queryKey }: Query) => queryKey[0] === "network" && failed.includes(Number(queryKey[1]));
  return (
    <InfoAlert
      variant="error"
      title={t("Couldn't load your deposits on {{networks}}. Your balance may be incomplete.", {
        networks: failed.map((id) => chains.get(id)?.name).join(", "),
      })}
      actionText={t("Try again")}
      loading={useIsFetching({ predicate }) > 0}
      onPress={() => {
        queryClient.refetchQueries({ predicate }).catch(reportError);
      }}
    />
  );
}
