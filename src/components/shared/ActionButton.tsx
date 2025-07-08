import React from "react";
import { useTranslation } from "react-i18next";
import { Spinner } from "tamagui";

import Button from "./Button";

export default function ActionButton({
  disabled = false,
  isLoading = false,
  loadingContent,
  ...rest
}: React.ComponentProps<typeof Button> & { disabled?: boolean; isLoading?: boolean; loadingContent?: string }) {
  const { t } = useTranslation();
  const loading = loadingContent ?? t("Loading...");
  return (
    <Button
      contained
      main
      spaced
      {...rest}
      iconAfter={
        isLoading ? (
          <Spinner color={disabled ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"} />
        ) : (
          rest.iconAfter
        )
      }
    >
      {isLoading ? loading : (rest.children ?? rest.content)}
    </Button>
  );
}
