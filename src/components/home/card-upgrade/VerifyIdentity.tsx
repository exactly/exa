import React from "react";
import { useTranslation } from "react-i18next";

import { IdCard } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Spinner, YStack } from "tamagui";

import Progression from "./Progression";
import queryClient from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import useBeginKYC from "../../../utils/useBeginKYC";
import Button from "../../shared/Button";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function VerifyIdentity() {
  const { t } = useTranslation();
  const toast = useToastController();
  const beginKYC = useBeginKYC();

  return (
    <View fullScreen flex={1} gap="$s6" paddingHorizontal="$s5" paddingTop="$s5">
      <YStack gap="$s4">
        <IdCard size={32} color="$uiBrandSecondary" />
        <Text emphasized title3 color="$uiBrandSecondary">
          {t("Verify your identity")}
        </Text>
      </YStack>
      <YStack>
        <Text color="$uiNeutralSecondary" subHeadline>
          {t(
            "To upgrade your Exa Card, we first need to verify your identity so you can continue spending your onchain assets seamlessly.",
          )}
        </Text>
      </YStack>
      <Progression />
      <YStack paddingBottom="$s7">
        <Button
          disabled={beginKYC.isPending}
          onPress={() => {
            beginKYC.mutate(undefined, {
              onSuccess(result) {
                if (result.status === "complete") queryClient.setQueryData(["card-upgrade"], 1);
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
          }}
          flexBasis={60}
          contained
          main
          spaced
          fullwidth
          color={beginKYC.isPending ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
          backgroundColor={beginKYC.isPending ? "$interactiveDisabled" : "$uiBrandSecondary"}
          iconAfter={
            beginKYC.isPending ? (
              <Spinner color="$interactiveOnDisabled" />
            ) : (
              <IdCard strokeWidth={2.5} color="$interactiveOnBaseBrandDefault" />
            )
          }
        >
          {t("Start verification")}
        </Button>
      </YStack>
    </View>
  );
}
