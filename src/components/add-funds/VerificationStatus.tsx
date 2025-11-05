import { ArrowLeft, ArrowRight } from "@tamagui/lucide-icons";
import { openURL } from "expo-linking";
import { useLocalSearchParams, useNavigation } from "expo-router";
import React, { useState } from "react";
import { Platform, Pressable } from "react-native";
import { ScrollView, Spinner, YStack } from "tamagui";

import LinkSheet from "./LinkSheet";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import FaceId from "../../assets/images/face-id.svg";
import reportError from "../../utils/reportError";
import type { OnRampProvider } from "../../utils/server";
import useOnRampProviders from "../../utils/useOnRampProviders";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function VerificationStatus() {
  const navigation = useNavigation<AppNavigationProperties>();
  const [linkOpen, setLinkOpen] = useState(false);
  const { data: providers, refetch: refetchProviders, isPending } = useOnRampProviders();

  const parameters = useLocalSearchParams<{
    provider: OnRampProvider;
    currency?: string;
    status: "ONBOARDING" | "MISSING_INFORMATION";
  }>();

  const providerData = providers?.providers[parameters.provider];
  const kycLink = providerData?.pendingTasks?.[0]?.link;

  function handleContinue() {
    if (parameters.status === "MISSING_INFORMATION" && kycLink) {
      if (Platform.OS === "web") {
        openURL(kycLink).catch(reportError);
      } else {
        setLinkOpen(true);
      }
      return;
    }
    handleClose();
  }

  function handleClose() {
    navigation.replace("add-funds", { screen: "index" });
  }

  async function handleKYCSuccess() {
    setLinkOpen(false);
    const { data: updatedProviders } = await refetchProviders();

    if (!updatedProviders) return;

    const newStatus = updatedProviders.providers[parameters.provider].status;

    if (newStatus === "ACTIVE" && parameters.currency) {
      navigation.replace("add-funds", {
        screen: "ramp-details",
        params: {
          provider: parameters.provider,
          currency: parameters.currency,
        },
      });
    } else if (newStatus === "ONBOARDING") {
      navigation.setParams({ status: "ONBOARDING" });
    }
  }

  return (
    <SafeView fullScreen>
      <View gap={20} fullScreen padded>
        <View gap={20}>
          <Pressable onPress={handleClose}>
            <ArrowLeft size={24} color="$uiNeutralPrimary" />
          </Pressable>
        </View>
        <ScrollView flex={1}>
          <View flex={1} gap={20}>
            <YStack flex={1} padding="$s4" gap="$s6">
              <YStack flex={1} justifyContent="center">
                <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
                  <FaceId width="100%" height="100%" />
                </View>
                <YStack gap="$s4" alignSelf="center">
                  <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault" whiteSpace="pre-line">
                    {parameters.status === "MISSING_INFORMATION"
                      ? "We need more\ninformation about you"
                      : "Almost there!"}
                  </Text>
                  <YStack>
                    {parameters.status === "ONBOARDING" && (
                      <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                        We&apos;re verifying your information.
                      </Text>
                    )}
                    {parameters.currency && (
                      <Text color="$uiNeutralPlaceholder" footnote textAlign="center">
                        You&apos;ll be able to add funds in {parameters.currency} soon.
                      </Text>
                    )}
                  </YStack>
                </YStack>
              </YStack>
            </YStack>
          </View>
        </ScrollView>
        <Button onPress={handleContinue} primary disabled={isPending || !providerData}>
          <Button.Text>{parameters.status === "MISSING_INFORMATION" ? "Continue" : "Close"}</Button.Text>
          <Button.Icon>
            {isPending ? (
              <Spinner color="$interactiveOnBaseBrandDefault" width={24} height={24} />
            ) : (
              <ArrowRight color="$interactiveOnBaseBrandDefault" />
            )}
          </Button.Icon>
        </Button>
      </View>

      {parameters.status === "MISSING_INFORMATION" && (
        <LinkSheet
          open={linkOpen}
          onClose={() => {
            setLinkOpen(false);
          }}
          provider={parameters.provider}
          uri={kycLink ?? ""}
          onSuccess={handleKYCSuccess}
        />
      )}
    </SafeView>
  );
}
