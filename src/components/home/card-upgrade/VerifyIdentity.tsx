import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { IdCard } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Spinner, YStack } from "tamagui";

import { useMutation } from "@tanstack/react-query";

import Progression from "./Progression";
import { cancelKYC, startKYC } from "../../../utils/persona";
import queryClient from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import { APIError, type KYCStatus } from "../../../utils/server";
import Button from "../../shared/Button";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function VerifyIdentity() {
  const toast = useToastController();
  const { t } = useTranslation();

  useEffect(() => cancelKYC, []);

  const { mutate: beginKYC, isPending } = useMutation({
    mutationKey: ["kyc"],
    async mutationFn() {
      try {
        const status = await queryClient.fetchQuery<KYCStatus>({ queryKey: ["kyc", "status"], staleTime: 0 });
        if ("code" in status && (status.code === "ok" || status.code === "legacy kyc")) {
          queryClient.setQueryData(["card-upgrade"], 1);
          return;
        }
      } catch (error) {
        if (!(error instanceof APIError)) {
          throw error;
        }
        if (error.text !== "not started" && error.text !== "no kyc") {
          throw error;
        }
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
          disabled={isPending}
          onPress={() => {
            beginKYC();
          }}
          flexBasis={60}
          contained
          main
          spaced
          fullwidth
          color={isPending ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
          backgroundColor={isPending ? "$interactiveDisabled" : "$uiBrandSecondary"}
          iconAfter={
            isPending ? (
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
