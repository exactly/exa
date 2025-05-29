import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import type { Passkey } from "@exactly/common/validation";
import { ChevronRight, CircleHelp, CreditCard, DollarSign, Eye, EyeOff, Hash, Snowflake } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, Separator, Spinner, Square, Switch, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import CardDetails from "./CardDetails";
import CardDisclaimer from "./CardDisclaimer";
import CardPIN from "./CardPIN";
import SpendingLimits from "./SpendingLimits";
import VerificationFailure from "./VerificationFailure";
import ExaCard from "./exa-card/ExaCard";
import {
  useReadPreviewerExactly,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import { createInquiry, KYC_TEMPLATE_ID, resumeInquiry } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import { APIError, getActivity, getCard, createCard, getKYCStatus, setCardStatus } from "../../utils/server";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import PluginUpgrade from "../shared/PluginUpgrade";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Card() {
  const theme = useTheme();
  const toast = useToastController();
  const { presentArticle } = useIntercom();
  const [displayPIN, setDisplayPIN] = useState(false);
  const [disclaimerShown, setDisclaimerShown] = useState(false);
  const [verificationFailureShown, setVerificationFailureShown] = useState(false);
  const { data: cardDetailsOpen } = useQuery<boolean>({ queryKey: ["card-details-open"] });
  const [spendingLimitsOpen, setSpendingLimitsOpen] = useState(false);
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  function toggle() {
    queryClient.setQueryData(["settings", "sensitive"], !hidden);
  }
  const { data: passkey } = useQuery<Passkey>({ queryKey: ["passkey"] });
  const {
    data: purchases,
    refetch: refetchPurchases,
    isPending,
  } = useQuery({
    queryKey: ["activity", "card"],
    queryFn: () => getActivity({ include: "card" }),
  });

  const { queryKey } = useAsset(marketUSDCAddress);
  const { address } = useAccount();
  const { data: KYCStatus, refetch: refetchKYCStatus } = useQuery({
    queryKey: ["kyc", "status"],
    queryFn: async () => getKYCStatus(KYC_TEMPLATE_ID),
  });
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { refetch: refetchInstalledPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
    query: { enabled: !!address && !!bytecode },
  });

  const { data: markets, refetch: refetchMarkets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
  });

  let usdBalance = 0n;
  if (markets) {
    for (const market of markets) {
      if (market.floatingDepositAssets > 0n) {
        usdBalance += (market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals);
      }
    }
  }

  const {
    data: cardDetails,
    refetch: refetchCard,
    isFetching: isFetchingCard,
  } = useQuery({
    queryKey: ["card", "details"],
    queryFn: getCard,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });

  const {
    mutateAsync: revealCard,
    isPending: isRevealing,
    error: revealError,
  } = useMutation({
    mutationKey: ["card", "reveal"],
    mutationFn: async function handleReveal() {
      if (usdBalance === 0n) {
        router.push("/getting-started");
        return;
      }
      if (isRevealing) return;
      if (!passkey) return;
      try {
        const { isSuccess, error } = await refetchCard();
        if (error && error instanceof APIError && error.code === 500) throw error;
        if (isSuccess) {
          queryClient.setQueryData(["card-details-open"], true);
          return;
        }
        const result = await getKYCStatus(KYC_TEMPLATE_ID);
        if (result === "ok") {
          setDisclaimerShown(true);
          return;
        }
        if (typeof result !== "string") {
          resumeInquiry(result.inquiryId, result.sessionToken).catch(reportError);
        }
      } catch (error) {
        if (!(error instanceof APIError)) {
          reportError(error);
          return;
        }
        const { text } = error;
        if (text === "kyc not approved") {
          setVerificationFailureShown(true);
          return;
        }
        if (text === "kyc required" || text === "kyc not found" || text === "kyc not started") {
          createInquiry(passkey).catch(reportError);
        }
        reportError(error);
        toast.show("An error occurred. Please try again later.", {
          native: true,
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
      }
    },
  });

  const {
    mutateAsync: changeCardStatus,
    isPending: isSettingCardStatus,
    variables: optimisticCardStatus,
  } = useMutation({
    mutationKey: ["card", "status"],
    mutationFn: setCardStatus,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["card", "details"] });
    },
  });

  const { mutateAsync: generateCard, isPending: isGeneratingCard } = useMutation({
    mutationKey: ["card", "create"],
    retry: (_, error) => error instanceof APIError,
    retryDelay: (failureCount, error) => (error instanceof APIError ? failureCount * 5000 : 1000),
    mutationFn: async () => {
      if (!passkey) return;
      await createCard();
    },
    onSuccess: async () => {
      toast.show("Card activated!", {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "success" },
      });
      const { data: card } = await refetchCard();
      if (card) queryClient.setQueryData(["card-details-open"], true);
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
        await queryClient.setQueryData(["card-details-open"], true);
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

  const displayStatus = isSettingCardStatus ? optimisticCardStatus : cardDetails?.status;
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <ScrollView
          ref={cardScrollReference}
          backgroundColor="$backgroundMild"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              ref={cardRefreshControlReference}
              style={style}
              refreshing={isPending}
              onRefresh={() => {
                refetchCard().catch(reportError);
                refetchPurchases().catch(reportError);
                refetchMarkets().catch(reportError);
                refetchKYCStatus().catch(reportError);
                refetchInstalledPlugins().catch(reportError);
                queryClient.refetchQueries({ queryKey }).catch(reportError);
              }}
            />
          }
        >
          <View fullScreen>
            <View flex={1}>
              <View alignItems="center" gap="$s4" width="100%" backgroundColor="$backgroundSoft" padded>
                <XStack gap={10} justifyContent="space-between" alignItems="center" width="100%">
                  <Text fontSize={20} fontWeight="bold">
                    My Exa Card*
                  </Text>
                  <View display="flex" flexDirection="row" alignItems="center" gap={16}>
                    <Pressable onPress={toggle} hitSlop={15}>
                      {hidden ? (
                        <EyeOff size={24} color="$uiNeutralPrimary" />
                      ) : (
                        <Eye size={24} color="$uiNeutralPrimary" />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        presentArticle("10022626").catch(reportError);
                      }}
                      hitSlop={15}
                    >
                      <CircleHelp size={24} color="$uiNeutralPrimary" />
                    </Pressable>
                  </View>
                </XStack>
                {(usdBalance === 0n || KYCStatus !== "ok") && (
                  <InfoAlert
                    title="Your card is awaiting activation. Follow the steps to enable it."
                    actionText="Get started"
                    onPress={() => {
                      router.push("/getting-started");
                    }}
                  />
                )}
                <PluginUpgrade />
                <ExaCard
                  revealing={isRevealing || isGeneratingCard}
                  frozen={cardDetails?.status === "FROZEN"}
                  onPress={() => {
                    if (isRevealing || isGeneratingCard) return;
                    revealCard().catch(reportError);
                  }}
                />
                <YStack
                  borderRadius="$r3"
                  borderWidth={1}
                  borderColor="$borderNeutralSoft"
                  width="100%"
                  paddingHorizontal="$s4"
                >
                  {cardDetails && (
                    <>
                      <XStack
                        justifyContent="space-between"
                        paddingVertical="$s4"
                        alignItems="center"
                        cursor="pointer"
                        onPress={() => {
                          if (isFetchingCard || isSettingCardStatus) return;
                          changeCardStatus(cardDetails.status === "FROZEN" ? "ACTIVE" : "FROZEN").catch(reportError);
                        }}
                      >
                        <XStack alignItems="center" gap="$s3">
                          <Square size={24}>
                            {isSettingCardStatus ? (
                              <Spinner width={24} color="$interactiveBaseBrandDefault" alignSelf="flex-start" />
                            ) : (
                              <Snowflake size={24} color="$interactiveBaseBrandDefault" fontWeight="bold" />
                            )}
                          </Square>
                          <Text subHeadline color="$uiNeutralPrimary">
                            {displayStatus === "FROZEN" ? "Unfreeze card" : "Freeze card"}
                          </Text>
                        </XStack>
                        <Switch
                          scale={0.9}
                          margin={0}
                          padding={0}
                          pointerEvents="none"
                          checked={displayStatus === "FROZEN"}
                          backgroundColor="$backgroundMild"
                          borderColor="$borderNeutralSoft"
                        >
                          <Switch.Thumb
                            checked={displayStatus === "FROZEN"}
                            shadowColor="$uiNeutralSecondary"
                            animation="moderate"
                            backgroundColor={
                              displayStatus === "ACTIVE" ? "$interactiveDisabled" : "$interactiveBaseBrandDefault"
                            }
                          />
                        </Switch>
                      </XStack>
                      <Separator borderColor="$borderNeutralSoft" />
                    </>
                  )}

                  <XStack
                    alignItems="center"
                    paddingVertical="$s4"
                    justifyContent="space-between"
                    cursor="pointer"
                    onPress={() => {
                      revealCard().catch(reportError);
                    }}
                  >
                    <XStack gap="$s3" justifyContent="flex-start" alignItems="center">
                      <CreditCard size={24} color="$interactiveBaseBrandDefault" fontWeight="bold" />
                      <Text subHeadline color="$uiNeutralPrimary">
                        Card details
                      </Text>
                    </XStack>
                    <ChevronRight color="$iconSecondary" size={24} />
                  </XStack>

                  <Separator borderColor="$borderNeutralSoft" />

                  {cardDetails && cardDetails.provider === "panda" && (
                    <>
                      <XStack
                        alignItems="center"
                        paddingVertical="$s4"
                        justifyContent="space-between"
                        cursor="pointer"
                        onPress={() => {
                          setDisplayPIN(true);
                        }}
                      >
                        <XStack gap="$s3" justifyContent="flex-start" alignItems="center">
                          <Hash size={24} color="$backgroundBrand" />
                          <Text subHeadline color="$uiNeutralPrimary">
                            View PIN number
                          </Text>
                        </XStack>
                        <ChevronRight color="$iconSecondary" size={24} />
                      </XStack>
                      <Separator borderColor="$borderNeutralSoft" />
                    </>
                  )}

                  <XStack
                    alignItems="center"
                    paddingVertical="$s4"
                    justifyContent="space-between"
                    cursor="pointer"
                    onPress={() => {
                      setSpendingLimitsOpen(true);
                    }}
                  >
                    <XStack gap="$s3" justifyContent="flex-start" alignItems="center">
                      <DollarSign size={24} color="$backgroundBrand" />
                      <Text subHeadline color="$uiNeutralPrimary">
                        Spending limit
                      </Text>
                    </XStack>
                    <ChevronRight color="$iconSecondary" size={24} />
                  </XStack>
                </YStack>
                {revealError && (
                  <Text color="$uiErrorPrimary" fontWeight="bold">
                    {revealError.message}
                  </Text>
                )}
              </View>
              <View padded gap="$s5">
                <LatestActivity
                  activity={purchases}
                  title="Latest purchases"
                  emptyComponent={
                    <YStack alignItems="center" justifyContent="center" gap="$s4_5" padding="$s4" paddingTop={0}>
                      <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
                        💳
                      </Text>
                      <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
                        Make your first purchase today!
                      </Text>
                      <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
                        Your transactions will show up here once you start using your card.
                      </Text>
                    </YStack>
                  }
                />
                <Text color="$interactiveOnDisabled" caption2 textAlign="justify">
                  *The Exa Card is issued by Third National pursuant to a license from Visa. Any credit issued by
                  Exactly Protocol subject to its separate terms and conditions. Third National is not a party to any
                  agreement with Exactly Protocol and is not responsible for any loan or credit arrangement between user
                  and Exactly Protocol.
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
        <CardDetails
          open={cardDetailsOpen ?? false}
          onClose={() => {
            queryClient.setQueryData(["card-details-open"], false);
          }}
        />
        <SpendingLimits
          open={spendingLimitsOpen}
          onClose={() => {
            setSpendingLimitsOpen(false);
          }}
        />
        <CardPIN
          open={displayPIN}
          onClose={() => {
            setDisplayPIN(false);
          }}
        />
        <CardDisclaimer
          open={disclaimerShown}
          onActionPress={() => {
            setDisclaimerShown(false);
            generateCard().catch(reportError);
          }}
          onClose={() => {
            setDisclaimerShown(false);
          }}
        />
        <VerificationFailure
          open={verificationFailureShown}
          onClose={() => {
            setVerificationFailureShown(false);
          }}
        />
      </View>
    </SafeView>
  );
}

export const cardScrollReference = React.createRef<ScrollView>();
export const cardRefreshControlReference = React.createRef<RefreshControl>();
