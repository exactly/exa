import type { Credential } from "@exactly/common/validation";
import { IdCard } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigation } from "expo-router";
import React from "react";
import { Spinner, YStack } from "tamagui";

import Progression from "./Progression";
import type { AppNavigationProperties } from "../../../app/(app)/_layout";
import { createInquiry, KYC_TEMPLATE_ID, resumeInquiry } from "../../../utils/persona";
import queryClient from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import { APIError, getKYCStatus } from "../../../utils/server";
import Button from "../../shared/Button";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function VerifyIdentity() {
  const toast = useToastController();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const navigation = useNavigation<AppNavigationProperties>();
  const { mutateAsync: startKYC, isPending } = useMutation({
    mutationKey: ["kyc"],
    mutationFn: async () => {
      if (!credential) throw new Error("missing credential");
      try {
        const result = await getKYCStatus(KYC_TEMPLATE_ID);
        if (result === "ok") {
          queryClient.setQueryData(["card-upgrade"], 1);
          return;
        }
        if (typeof result !== "string") {
          await resumeInquiry(result.inquiryId, result.sessionToken, navigation);
        }
      } catch (error) {
        if (!(error instanceof APIError)) {
          reportError(error);
          return;
        }
        if (error.text === "kyc required" || error.text === "kyc not found" || error.text === "kyc not started") {
          await createInquiry(credential, navigation);
          return;
        }
        reportError(error);
      }
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["kyc", "status"] });
    },
    onError: (error) => {
      toast.show("Error verifying identity", {
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
          Verify your identity
        </Text>
      </YStack>
      <YStack>
        <Text color="$uiNeutralSecondary" subHeadline>
          To upgrade your Exa Card, we first need to verify your identity so you can continue spending your onchain
          assets seamlessly.
        </Text>
      </YStack>
      <Progression />
      <YStack paddingBottom="$s7">
        <Button
          disabled={isPending}
          onPress={() => {
            startKYC().catch(reportError);
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
          Start verification
        </Button>
      </YStack>
    </View>
  );
}
