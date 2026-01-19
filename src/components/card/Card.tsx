import React, { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable, RefreshControl } from "react-native";

import { useRouter } from "expo-router";

import { ChevronRight, CircleHelp, CreditCard, DollarSign, Eye, EyeOff, Hash, Snowflake } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, Spinner, Square, Switch, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import {
  useReadPreviewerExactly,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "@exactly/common/generated/hooks";

import CardDetails from "./CardDetails";
import CardDisclaimer from "./CardDisclaimer";
import CardPIN from "./CardPIN";
import ExaCard from "./exa-card/ExaCard";
import SpendingLimits from "./SpendingLimits";
import VerificationFailure from "./VerificationFailure";
import { presentArticle } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import { createInquiry, KYC_TEMPLATE_ID, resumeInquiry } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import {
  APIError,
  createCard,
  getActivity,
  getKYCStatus,
  setCardStatus,
  type CardDetails as CardDetailsData,
} from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useTabPress from "../../utils/useTabPress";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import PluginUpgrade from "../shared/PluginUpgrade";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";

export default function Card() {
  const toast = useToastController();
  const [displayPIN, setDisplayPIN] = useState(false);
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const [disclaimerShown, setDisclaimerShown] = useState(false);
  const [verificationFailureShown, setVerificationFailureShown] = useState(false);
  const { data: cardDetailsOpen } = useQuery<boolean>({ queryKey: ["card-details-open"] });
  const [spendingLimitsOpen, setSpendingLimitsOpen] = useState(false);
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });

  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const {
    data: purchases,
    refetch: refetchPurchases,
    isFetching: isFetchingPurchases,
  } = useQuery({
    queryKey: ["activity", "card"],
    queryFn: () => getActivity({ include: "card" }),
  });

  const {
    data: cardDetails,
    refetch: refetchCard,
    isFetching: isFetchingCard,
  } = useQuery<CardDetailsData>({ queryKey: ["card", "details"], retry: false, gcTime: 0, staleTime: 0 });

  const limit = cardDetails?.limit.amount ? cardDetails.limit.amount / 100 : undefined;
  const weeklyPurchases = purchases
    ? purchases.filter((item) => {
        if (item.type !== "panda") return false;
        const elapsedTime = (Date.now() - new Date(item.timestamp).getTime()) / 1000;
        return elapsedTime <= 604_800;
      })
    : [];
  const totalSpent = weeklyPurchases.reduce((accumulator, item) => accumulator + item.usdAmount, 0);

  const { queryKey, isFetching: isFetchingAsset } = useAsset(marketUSDCAddress);
  const { address } = useAccount();
  const {
    data: KYCStatus,
    refetch: refetchKYCStatus,
    isFetching: isFetchingKYC,
  } = useQuery({
    queryKey: ["kyc", "status"],
    queryFn: async () => getKYCStatus(KYC_TEMPLATE_ID),
    meta: {
      suppressError: (error) =>
        error instanceof APIError &&
        (error.text === "kyc not found" || error.text === "kyc not started" || error.text === "kyc not approved"),
    },
  });
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { refetch: refetchInstalledPlugins, isFetching: isFetchingPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address: address ?? zeroAddress,
      query: { enabled: !!address && !!bytecode },
    });

  const {
    data: markets,
    refetch: refetchMarkets,
    isFetching: isFetchingMarkets,
  } = useReadPreviewerExactly({
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

  const isRefreshing =
    isFetchingCard || isFetchingPurchases || isFetchingMarkets || isFetchingKYC || isFetchingPlugins || isFetchingAsset;

  const scrollRef = useRef<ScrollView>(null);
  const refresh = () => {
    refetchCard().catch(reportError);
    refetchPurchases().catch(reportError);
    refetchMarkets().catch(reportError);
    refetchKYCStatus().catch(reportError);
    refetchInstalledPlugins().catch(reportError);
    queryClient.refetchQueries({ queryKey }).catch(reportError);
  };
  useTabPress("card", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh();
  });

  const {
    mutateAsync: revealCard,
    isPending: isRevealing,
    error: revealError,
  } = useMutation({
    mutationKey: ["card", "reveal"],
    mutationFn: async function handleReveal() {
      if (usdBalance === 0n) {
        router.push("/(main)/getting-started");
        return;
      }
      if (isRevealing) return;
      if (!credential) return;
      try {
        const { data, error } = await refetchCard();
        if (error && error instanceof APIError && error.code === 500) throw error;
        if (data) {
          queryClient.setQueryData(["card-details-open"], true);
          return;
        }
        const result = await getKYCStatus(KYC_TEMPLATE_ID);
        if (result === "ok") {
          setDisclaimerShown(true);
          return;
        }
        if (typeof result !== "string") await resumeInquiry(result.inquiryId, result.sessionToken);
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
          await createInquiry(credential);
        }
        reportError(error);
        toast.show(t("An error occurred. Please try again later."), {
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
      if (!credential) return;
      await createCard();
    },
    onSuccess: async () => {
      toast.show(t("Card activated!"), {
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
        toast.show(t("Error activating card"), {
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
      toast.show(t("Error activating card"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const displayStatus = isSettingCardStatus ? optimisticCardStatus : cardDetails?.status;
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={scrollRef}
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        >
          <View fullScreen>
            <View flex={1}>
              <View alignItems="center" gap="$s4" width="100%" backgroundColor="$backgroundSoft" padded>
                <XStack gap={10} justifyContent="space-between" alignItems="center" width="100%">
                  <Text fontSize={20} fontWeight="bold">
                    {t("My Exa Card")}
                  </Text>
                  <View display="flex" flexDirection="row" alignItems="center" gap={16}>
                    <Pressable
                      onPress={() => {
                        queryClient.setQueryData(["settings", "sensitive"], !hidden);
                      }}
                      hitSlop={15}
                    >
                      {hidden ? (
                        <EyeOff size={24} color="$uiNeutralSecondary" />
                      ) : (
                        <Eye size={24} color="$uiNeutralSecondary" />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        presentArticle("10022626").catch(reportError);
                      }}
                      hitSlop={15}
                    >
                      <CircleHelp size={24} color="$uiNeutralSecondary" />
                    </Pressable>
                  </View>
                </XStack>
                {(usdBalance === 0n || KYCStatus !== "ok") && (
                  <InfoAlert
                    title={t("Your card is awaiting activation. Follow the steps to enable it.")}
                    actionText={t("Get started")}
                    onPress={() => {
                      router.push("/(main)/getting-started");
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
                        {t("Card details")}
                      </Text>
                    </XStack>
                    <ChevronRight color="$uiBrandSecondary" size={24} />
                  </XStack>

                  <Separator borderColor="$borderNeutralSoft" />

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
                            {displayStatus === "FROZEN" ? t("Unfreeze card") : t("Freeze card")}
                          </Text>
                        </XStack>
                        <XStack alignItems="center" justifyContent="center" height={24}>
                          <Switch
                            scale={0.9}
                            margin={0}
                            padding={0}
                            pointerEvents="none"
                            checked={displayStatus === "FROZEN"}
                            backgroundColor="$backgroundMild"
                            borderColor="$borderNeutralSoft"
                            height={24}
                            width={60}
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
                      </XStack>
                      <Separator borderColor="$borderNeutralSoft" />
                    </>
                  )}

                  {cardDetails && (
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
                            {t("View PIN number")}
                          </Text>
                        </XStack>
                        <ChevronRight color="$uiBrandSecondary" size={24} />
                      </XStack>
                      <Separator borderColor="$borderNeutralSoft" />
                    </>
                  )}

                  <XStack
                    alignItems="center"
                    paddingVertical="$s4"
                    justifyContent="space-between"
                    cursor="pointer"
                    gap="$s3"
                    onPress={() => {
                      if (!limit) return;
                      setSpendingLimitsOpen(true);
                    }}
                  >
                    <XStack gap="$s3" justifyContent="flex-start" alignItems="center">
                      <DollarSign size={24} color="$backgroundBrand" />
                      <Text subHeadline color="$uiNeutralPrimary">
                        {t("Weekly spending limit")}
                      </Text>
                    </XStack>
                    <XStack alignItems="center">
                      {limit ? (
                        <>
                          <Text caption emphasized color="$uiBrandSecondary" lineHeight={24}>
                            {(limit - totalSpent).toLocaleString(language, {
                              style: "currency",
                              currency: "USD",
                              currencyDisplay: "narrowSymbol",
                              maximumFractionDigits: 0,
                            })}
                          </Text>
                          <ChevronRight color="$uiBrandSecondary" size={24} />
                        </>
                      ) : isFetchingCard ? (
                        <Skeleton width={100} height={16} />
                      ) : null}
                    </XStack>
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
                  title={t("Latest purchases")}
                  emptyComponent={
                    <YStack alignItems="center" justifyContent="center" gap="$s4_5" padding="$s4" paddingTop={0}>
                      <Text textAlign="center" color="$uiNeutralSecondary" emphasized title>
                        💳
                      </Text>
                      <Text textAlign="center" color="$uiBrandSecondary" emphasized headline>
                        {t("Make your first purchase today!")}
                      </Text>
                      <Text textAlign="center" color="$uiNeutralSecondary" subHeadline>
                        {t("Your transactions will show up here once you start using your card.")}
                      </Text>
                    </YStack>
                  }
                />
                <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3" flexWrap="wrap">
                  <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                    <Trans
                      i18nKey="The Exa Card is issued by Third National Bank under a Visa license. Credit features are provided solely by <link>Exactly Protocol</link>, a decentralized service not affiliated with Third National. Third National Bank is not responsible for any funding or credit services provided by <link>Exactly Protocol</link>."
                      components={{
                        link: (
                          <Text
                            cursor="pointer"
                            caption2
                            color="$interactiveOnDisabled"
                            textDecorationLine="underline"
                            onPress={() => {
                              openBrowser("https://exact.ly/").catch(reportError);
                            }}
                          />
                        ),
                      }}
                    />
                  </Text>
                </XStack>
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
          totalSpent={totalSpent}
          limit={limit}
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
