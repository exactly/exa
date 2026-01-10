import { ArrowRight, CreditCard } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable } from "react-native";
import { YStack } from "tamagui";

import Progression from "./Progression";
import { presentArticle } from "../../../utils/intercom";
import queryClient from "../../../utils/queryClient";
import reportError from "../../../utils/reportError";
import { APIError, createCard } from "../../../utils/server";
import Button from "../../shared/Button";
import Spinner from "../../shared/Spinner";
import Text from "../../shared/Text";
import View from "../../shared/View";

export default function ActivateCard() {
  const toast = useToastController();
  const { data: step } = useQuery<number | undefined>({ queryKey: ["card-upgrade"] });
  const router = useRouter();
  const { mutateAsync: activateCard, isPending: isActivating } = useMutation({
    retry: (_, error) => error instanceof APIError,
    retryDelay: (failureCount, error) => (error instanceof APIError ? failureCount * 5000 : 1000),
    mutationFn: createCard,
    onSuccess: async () => {
      toast.show("Card activated!", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success" },
      });
      await queryClient.refetchQueries({ queryKey: ["card", "details"] });
      await queryClient.setQueryData(["card-upgrade-open"], false);
      await queryClient.resetQueries({ queryKey: ["card-upgrade"] });
      router.push("/card");
      queryClient.setQueryData(["card-details-open"], true);
    },
    onError: async (error: Error) => {
      if (!(error instanceof APIError)) {
        reportError(error);
        toast.show("Error activating card", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      if (error.text.includes("card already exists")) {
        await queryClient.refetchQueries({ queryKey: ["card", "details"] });
        await queryClient.setQueryData(["card-upgrade-open"], false);
        await queryClient.resetQueries({ queryKey: ["card-upgrade"] });
        router.push("/card");
        queryClient.setQueryData(["card-details-open"], true);
        return;
      }
      reportError(error);
      toast.show("Error activating card", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });
  return (
    <View fullScreen flex={1} gap="$s6" paddingHorizontal="$s5" paddingTop="$s5">
      {isActivating ? (
        <>
          <YStack gap="$s6" justifyContent="center" alignItems="center">
            <Spinner color="$uiNeutralPrimary" backgroundColor="$backgroundMild" containerSize={52} size={32} />
            <YStack gap="$s2" justifyContent="center" alignItems="center">
              <Text emphasized title3 color="$uiNeutralSecondary">
                Activating your new Exa Card
              </Text>
              <Text color="$uiNeutralSecondary" footnote>
                STEP {(step ?? 0) + 1} OF 3
              </Text>
            </YStack>
            <Text color="$uiNeutralSecondary" subHeadline alignSelf="center" textAlign="center">
              This may take a moment. Please wait.
            </Text>
          </YStack>
        </>
      ) : (
        <>
          <YStack gap="$s4">
            <CreditCard size={32} color="$uiBrandSecondary" />
            <Text emphasized title3 color="$uiBrandSecondary">
              Activate your new Exa Card
            </Text>
          </YStack>
          <YStack>
            <Text color="$uiNeutralSecondary" subHeadline>
              Almost there! Activate your Exa Card to start spending your onchain assets instantly.
            </Text>
          </YStack>
          <Progression />
        </>
      )}
      <YStack paddingBottom="$s7">
        <YStack gap="$s4" paddingBottom={isActivating ? 0 : "$s7"}>
          {!isActivating && (
            <Pressable
              onPress={() => {
                presentArticle("10707672").catch(reportError);
              }}
            >
              <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                By continuing, you agree to both, the disclaimer below and the Exa Card&nbsp;
                <Text color="$interactiveTextBrandDefault" footnote>
                  Terms & Conditions.
                </Text>
              </Text>
            </Pressable>
          )}
          <Button
            onPress={() => {
              activateCard().catch(reportError);
            }}
            flexBasis={60}
            contained
            main
            spaced
            fullwidth
            backgroundColor={isActivating ? "$interactiveDisabled" : "$interactiveBaseBrandDefault"}
            color={isActivating ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
            iconAfter={
              <ArrowRight
                strokeWidth={2.5}
                color={isActivating ? "$interactiveOnDisabled" : "$interactiveOnBaseBrandDefault"}
              />
            }
          >
            Accept and activate Exa Card
          </Button>
        </YStack>
        {!isActivating && (
          <Text color="$interactiveOnDisabled" caption textAlign="justify">
            *The Exa Card is issued by Third National pursuant to a license from Visa. Any credit issued by Exactly
            Protocol subject to its separate terms and conditions. Third National is not a party to any agreement with
            Exactly Protocol and is not responsible for any funding or credit arrangement between user and Exactly
            Protocol.
          </Text>
        )}
      </YStack>
    </View>
  );
}
