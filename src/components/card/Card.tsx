import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Alert, AppState, Platform, Pressable } from "react-native";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { ChevronRight, CircleHelp, CreditCard, DollarSign, Eye, EyeOff, Hash, Snowflake } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, Spinner, Square, XStack, YStack } from "tamagui";

import { addBreadcrumb, captureMessage, startSpan, withScope } from "@sentry/react-native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { literal, object, safeParse, union } from "valibot";

import accountInit from "@exactly/common/accountInit";
import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import CardDetailsSheet from "./CardDetails";
import CardDisclaimer from "./CardDisclaimer";
import CardFreezeSheet from "./CardFreezeSheet";
import CardPIN from "./CardPIN";
import ExaCard from "./exa-card/ExaCard";
import SpendingLimits from "./SpendingLimits";
import TimeoutSheet from "./TimeoutSheet";
import VerificationFailure from "./VerificationFailure";
import GoogleWalletButtonEs from "../../assets/images/google-wallet-button-es.svg";
import GoogleWalletButtonPt from "../../assets/images/google-wallet-button-pt.svg";
import GoogleWalletButtonEn from "../../assets/images/google-wallet-button.svg";
import GoogleWalletIcon from "../../assets/images/google-wallet-icon.svg";
import { presentArticle } from "../../utils/intercom";
import initMeaWallet from "../../utils/meaWallet";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError, { classifyError } from "../../utils/reportError";
import {
  APIError,
  createCard,
  setCardStatus,
  type CardActivity,
  type CardDetails,
  type KYCStatus,
} from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useBeginKYC from "../../utils/useBeginKYC";
import useMarkets from "../../utils/useMarkets";
import useTabPress from "../../utils/useTabPress";
import { saveCardProvisioningSnapshot } from "../../utils/walletExtensionStorage";
import IconButton from "../shared/IconButton";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import PluginUpgrade from "../shared/PluginUpgrade";
import RefreshControl from "../shared/RefreshControl";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Switch from "../shared/Switch";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";
import type * as MeaWallet from "@meawallet/react-native-mpp";

// cspell:ignore UNTOKENIZED

type Wallet = typeof MeaWallet;
type WalletStatus = "added" | "cta" | "hidden";
type WalletEligibility = {
  apple: WalletStatus;
  google: WalletStatus;
  googleToken: MeaWallet.GooglePayTokenInfo | null;
};
type WalletProvider = "apple" | "google";
type WalletOperation = "add_payment_pass" | "eligibility" | "push_card" | "tokenize";
type WalletDiagnosticOperation = "sdk_init" | "wallet_availability" | WalletOperation;
type WalletDiagnosticStage =
  | "button"
  | "provisioning"
  | "sdk_init"
  | "token_lookup"
  | "ui_state"
  | "wallet_availability";
type WalletDiagnosticContext = {
  apple_status?: "unknown" | WalletStatus;
  card_added?: boolean;
  card_details_ready?: boolean;
  error_kind?: "cancelled" | "failed";
  google_eligibility_reason?:
    | "eligibility_failed"
    | "sdk_init_failed"
    | "token_lookup_failed"
    | "token_not_found"
    | "wallet_availability_failed";
  google_status?: "unknown" | WalletStatus;
  google_token_available?: boolean;
  provisioning?: boolean;
  wallet_eligible_present?: boolean;
};
const hiddenWallet = { apple: "hidden", google: "hidden", googleToken: null } satisfies WalletEligibility;
const googleWalletButtons = {
  en: { Component: GoogleWalletButtonEn, height: 32, width: 116 },
  es: { Component: GoogleWalletButtonEs, height: 32, width: 139 },
  pt: { Component: GoogleWalletButtonPt, height: 32, width: 140 },
} satisfies Record<string, { Component: typeof GoogleWalletButtonEn; height: number; width: number }>;
const primaryAccountIdentifiers = new Map<string, string>();

async function syncWalletEligibility(lastFour: string | undefined) {
  if (Platform.OS === "web" || lastFour?.length !== 4) return;
  return queryClient.refetchQueries({ exact: true, queryKey: ["wallet", "eligible", lastFour] });
}

export default function Card() {
  const toast = useToastController();
  const [displayPIN, setDisplayPIN] = useState(false);
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const googleWalletButton = language.startsWith("es")
    ? googleWalletButtons.es
    : language.startsWith("pt")
      ? googleWalletButtons.pt
      : googleWalletButtons.en;
  const GoogleWalletButton = googleWalletButton.Component;
  const [disclaimerShown, setDisclaimerShown] = useState(false);
  const [verificationFailureShown, setVerificationFailureShown] = useState(false);
  const [freezeConfirmOpen, setFreezeConfirmOpen] = useState(false);
  const [signal, setSignal] = useState(0);

  const { data: cardDetailsOpen } = useQuery<boolean>({ queryKey: ["card-details-open"] });
  const [spendingLimitsOpen, setSpendingLimitsOpen] = useState(false);
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });

  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: purchases } = useQuery<CardActivity[]>({
    queryKey: ["activity", "card"],
  });

  const {
    data: cardDetails,
    refetch: refetchCard,
    isFetching: isFetchingCard,
  } = useQuery<CardDetails>({ queryKey: ["card", "details"], retry: false, gcTime: 0, staleTime: 0 });

  useEffect(() => {
    if (!cardDetails) return;
    saveCardProvisioningSnapshot({
      displayName: cardDetails.displayName,
      expirationMonth: cardDetails.expirationMonth,
      expirationYear: cardDetails.expirationYear,
      lastFour: cardDetails.lastFour,
      productId: cardDetails.productId,
    }).catch(reportError);
  }, [cardDetails]);

  const limit = cardDetails?.limit.amount ? cardDetails.limit.amount / 100 : undefined;
  const weeklyPurchases = purchases
    ? purchases.filter((item): item is Extract<CardActivity, { type: "panda" }> => {
        if (item.type !== "panda" || item.status === "declined") return false;
        const elapsedTime = (Date.now() - new Date(item.timestamp).getTime()) / 1000;
        return elapsedTime <= 604_800;
      })
    : [];
  const totalSpent = weeklyPurchases.reduce((accumulator, item) => accumulator + item.usdAmount, 0);

  const { queryKey } = useAsset(marketUSDCAddress);
  const { address } = useAccount();
  const { data: kycStatus, isPending: isPendingKYC } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"] });
  const isKYCApproved = Boolean(
    kycStatus && "code" in kycStatus && (kycStatus.code === "ok" || kycStatus.code === "legacy kyc"),
  );
  const { refetch: refetchInstalledPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    chainId: chain.id,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { enabled: !!address && !!credential },
  });

  const { markets, refetch: refetchMarkets } = useMarkets();

  let usdBalance = 0n;
  if (markets) {
    for (const market of markets) {
      if (market.floatingDepositAssets > 0n) {
        usdBalance += (market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals);
      }
    }
  }

  const scrollRef = useRef<ScrollView>(null);
  const refresh = () =>
    Promise.all([
      refetchCard(),
      queryClient.invalidateQueries({ queryKey: ["activity", "card"], exact: true }),
      queryClient.invalidateQueries({ queryKey: ["kyc", "status"], exact: true }),
      address ? refetchMarkets() : undefined,
      address && credential ? refetchInstalledPlugins() : undefined,
      syncWalletEligibility(cardDetails?.lastFour),
      queryClient.refetchQueries({ queryKey }),
    ]);
  useTabPress("card", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh().catch(reportError);
  });

  const beginKYC = useBeginKYC();

  const {
    mutateAsync: revealCard,
    isPending: isRevealing,
    error: revealError,
  } = useMutation({
    mutationKey: ["card", "reveal"],
    mutationFn: async function handleReveal() {
      if (usdBalance === 0n && !cardDetails) {
        router.push("/(main)/getting-started");
        return;
      }
      if (isRevealing || beginKYC.isPending) return;
      try {
        const { data, error } = await refetchCard();
        if (error && error instanceof APIError && error.code === 500) throw error;
        if (data) {
          queryClient.setQueryData(["card-details-open"], true);
          return;
        }
        const status = await queryClient.fetchQuery<KYCStatus>({ queryKey: ["kyc", "status"], staleTime: 0 });
        if ("code" in status && (status.code === "ok" || status.code === "legacy kyc")) {
          setDisclaimerShown(true);
          return;
        }
      } catch (error) {
        if (!(error instanceof APIError)) {
          reportError(error);
          return;
        }
        const { text } = error;
        if (text === "bad kyc") {
          setVerificationFailureShown(true);
          return;
        }
        if (text !== "not started" && text !== "no kyc") {
          reportError(error);
          toast.show(t("An error occurred. Please try again later."), {
            duration: 1000,
            burntOptions: { haptic: "error", preset: "error" },
          });
          return;
        }
      }
      beginKYC.mutate(undefined, {
        onSuccess(result) {
          if (result.status === "cancel") return;
          const approved = "code" in result.kyc && (result.kyc.code === "ok" || result.kyc.code === "legacy kyc");
          if (approved) setDisclaimerShown(true);
        },
        onError(error) {
          if (error instanceof APIError && error.text === "bad kyc") {
            setVerificationFailureShown(true);
            return;
          }
          toast.show(t("An error occurred. Please try again later."), {
            duration: 1000,
            burntOptions: { haptic: "error", preset: "error" },
          });
          reportError(error);
        },
      });
    },
  });

  const {
    mutate: changeCardStatus,
    isPending: isSettingCardStatus,
    variables: optimisticCardStatus,
  } = useMutation({
    mutationKey: ["card", "status"],
    mutationFn: setCardStatus,
    onError: (error) => {
      reportError(error);
      toast.show(t("An error occurred. Please try again later."), {
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["card", "details"] });
    },
  });

  const {
    mutateAsync: generateCard,
    isPending: isGeneratingCard,
    failureCount: generateCardFailures,
    submittedAt: generateSubmittedAt,
  } = useMutation({
    mutationKey: ["card", "create"],
    retry: (_, error) => error instanceof APIError && !error.text.includes("already created"),
    retryDelay: (failureCount, error) => (error instanceof APIError ? failureCount * 5000 : 1000),
    mutationFn: async () => {
      if (!credential) return;
      await createCard();
    },
    onSuccess: async () => {
      toast.show(t("Card activated!"), {
        duration: 1000,
        burntOptions: { haptic: "success" },
      });
      queryClient.setQueryData<boolean>(["settings", "card-support-contacted"], false);
      const { data: card } = await refetchCard();
      if (card) queryClient.setQueryData(["card-details-open"], true);
    },
    onError: async (error: Error) => {
      if (!(error instanceof APIError)) {
        reportError(error);
        toast.show(t("Error activating card"), {
          duration: 1000,
          burntOptions: { haptic: "error", preset: "error" },
        });
        return;
      }
      if (error.text.includes("already created")) {
        queryClient.setQueryData<boolean>(["settings", "card-support-contacted"], false);
        await queryClient.refetchQueries({ queryKey: ["card", "details"] });
        await queryClient.setQueryData(["card-details-open"], true);
        return;
      }
      reportError(error);
      toast.show(t("Error activating card"), {
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
  });

  const [sdk, setSdk] = useState<null | Wallet>(null);
  const [provisioning, setProvisioning] = useState(false);
  const walletInFlightRef = useRef(false);
  const reportedWalletUiStateRef = useRef<string | undefined>(undefined);
  const { data: walletEligible, isPending: isPendingWallet } = useQuery<WalletEligibility>({
    queryKey: ["wallet", "eligible", cardDetails?.lastFour],
    enabled: Platform.OS !== "web" && cardDetails?.lastFour.length === 4,
    queryFn: async () => {
      const lastFour = cardDetails?.lastFour;
      if (!lastFour || Platform.OS === "web") return hiddenWallet;
      const provider = Platform.OS === "ios" ? "apple" : "google";
      const nextWallet = await traceWallet(provider, "sdk_init", initMeaWallet, { stage: "sdk_init" }).catch(
        (error: unknown) => {
          reportWalletError(
            error,
            provider,
            "eligibility",
            Platform.OS === "android" ? { google_eligibility_reason: "sdk_init_failed" } : undefined,
          );
          throw error;
        },
      );
      if (Platform.OS === "ios") {
        try {
          const [{ cardId, cardSecret }, available, canAdd] = await Promise.all([
            queryClient.fetchQuery<{ cardId: string; cardSecret: string }>({
              queryKey: ["card", "provisioning"],
              staleTime: 0,
            }),
            nextWallet.default.ApplePay.isPassLibraryAvailable(),
            nextWallet.default.ApplePay.canAddPaymentPass(),
          ]);
          const cachedPrimaryAccountIdentifier = primaryAccountIdentifiers.get(cardId);
          if (!available || !canAdd) return hiddenWallet;
          const response =
            cachedPrimaryAccountIdentifier === undefined
              ? await nextWallet.default.ApplePay.initializeOemTokenization(
                  nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
                )
              : { primaryAccountIdentifier: cachedPrimaryAccountIdentifier };
          const primaryAccountIdentifier = response.primaryAccountIdentifier;
          if (primaryAccountIdentifier) {
            primaryAccountIdentifiers.set(cardId, primaryAccountIdentifier);
            const secureElementPassExists =
              await nextWallet.default.ApplePay.secureElementPassExistsWithPrimaryAccountIdentifier(
                primaryAccountIdentifier,
              );
            const [canAddByPrimaryAccountIdentifier, canAddSecureElement] = await Promise.all([
              nextWallet.default.ApplePay.canAddPaymentPassWithPrimaryAccountIdentifier(primaryAccountIdentifier).catch(
                () => undefined,
              ),
              nextWallet.default.ApplePay.canAddSecureElementPassWithPrimaryAccountIdentifier(
                primaryAccountIdentifier,
              ).catch(() => undefined),
            ]);
            return {
              apple:
                canAddSecureElement === true ||
                canAddByPrimaryAccountIdentifier === true ||
                ((canAddSecureElement !== false || canAddByPrimaryAccountIdentifier !== false) &&
                  !secureElementPassExists)
                  ? "cta"
                  : "hidden",
              google: "hidden",
              googleToken: null,
            };
          }
          return { apple: "cta", google: "hidden", googleToken: null };
        } catch (error) {
          reportWalletError(error, "apple", "eligibility");
          return hiddenWallet;
        }
      }
      if (Platform.OS !== "android") return hiddenWallet;
      return traceWallet("google", "wallet_availability", () => nextWallet.default.GooglePay.isWalletAvailable(), {
        stage: "wallet_availability",
      })
        .catch((error: unknown) => {
          reportWalletError(error, "google", "eligibility", {
            google_eligibility_reason: "wallet_availability_failed",
          });
          return null;
        })
        .then(async (available) => {
          if (available === null) return hiddenWallet;
          if (!available) {
            reportGoogleWalletStatus("wallet_unavailable");
            return hiddenWallet;
          }
          reportWalletDiagnostic({
            provider: "google",
            operation: "eligibility",
            stage: "token_lookup",
            state: "started",
          });
          let tokenLookupNotFound: boolean | undefined;
          const tokens = await nextWallet.default.GooglePay.checkWalletForCardSuffix(lastFour).catch(
            (error: unknown) => {
              if (
                safeParse(
                  union([
                    object({ code: literal("GOOGLE_PAY_TOKEN_NOT_FOUND") }),
                    object({ userInfo: object({ code: literal(702) }) }),
                  ]),
                  error,
                ).success
              ) {
                tokenLookupNotFound = true;
                return [];
              }
              reportWalletDiagnostic({
                context: { error_kind: "failed" },
                provider: "google",
                operation: "eligibility",
                stage: "token_lookup",
                state: "failed",
              });
              reportWalletError(error, "google", "eligibility", { google_eligibility_reason: "token_lookup_failed" });
            },
          );
          if (tokens)
            reportWalletDiagnostic({
              context: tokenLookupNotFound ? { google_eligibility_reason: "token_not_found" } : undefined,
              provider: "google",
              operation: "eligibility",
              stage: "token_lookup",
              state: tokenLookupNotFound ? "not_added" : "succeeded",
            });
          if (!tokens) return hiddenWallet;
          const { GooglePayTokenState } = nextWallet;
          const googleVerificationToken =
            tokens.find(
              ({ tokenState }) => tokenState === GooglePayTokenState.TOKEN_STATE_NEEDS_IDENTITY_VERIFICATION,
            ) ?? null;
          const google = tokens.some(({ tokenState }) => tokenState === GooglePayTokenState.TOKEN_STATE_ACTIVE)
            ? "added"
            : googleVerificationToken ||
                tokens.every(
                  ({ tokenState }) =>
                    tokenState === GooglePayTokenState.TOKEN_STATE_NOT_FOUND ||
                    tokenState === GooglePayTokenState.TOKEN_STATE_UNTOKENIZED,
                )
              ? "cta"
              : "hidden";
          reportGoogleWalletStatus(
            google === "hidden" ? "token_state_hidden" : google,
            tokens.map(({ tokenState }) => tokenState),
          );
          return {
            apple: "hidden",
            google,
            googleToken:
              google === "cta" && googleVerificationToken
                ? {
                    isSelectedAsDefault: String(googleVerificationToken.isDefaultToken),
                    paymentNetwork: googleVerificationToken.paymentNetwork,
                    tokenId: googleVerificationToken.issuerTokenId,
                    tokenState: googleVerificationToken.tokenState,
                  }
                : null,
          } satisfies WalletEligibility;
        })
        .catch((error: unknown) => {
          reportWalletError(error, "google", "eligibility", { google_eligibility_reason: "eligibility_failed" });
          return hiddenWallet;
        });
    },
  });

  useEffect(() => {
    if (Platform.OS === "web" || cardDetails?.lastFour.length !== 4) return;
    const lastFour = cardDetails.lastFour;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      syncWalletEligibility(lastFour).catch(reportError);
    });
    return () => {
      subscription.remove();
    };
  }, [cardDetails?.lastFour]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const cardDetailsReady = cardDetails?.lastFour.length === 4;
    const state = cardDetailsReady
      ? isPendingWallet
        ? "eligibility_pending"
        : provisioning
          ? "provisioning_spinner"
          : walletEligible?.google === "added"
            ? "google_wallet_added"
            : walletEligible?.google === "cta"
              ? "google_button_visible"
              : walletEligible
                ? "wallet_row_hidden"
                : "eligibility_unavailable"
      : "card_details_missing";
    const key = [
      "ui",
      state,
      walletEligible?.google ?? "unknown",
      walletEligible?.googleToken !== null && walletEligible?.googleToken !== undefined,
      provisioning,
      isPendingWallet,
    ].join(":");
    if (reportedWalletUiStateRef.current === key) return;
    reportedWalletUiStateRef.current = key;
    reportWalletDiagnostic({
      context: {
        card_details_ready: cardDetailsReady,
        google_status: walletEligible?.google ?? "unknown",
        google_token_available: walletEligible?.googleToken !== null && walletEligible?.googleToken !== undefined,
        provisioning,
        wallet_eligible_present: walletEligible !== undefined,
      },
      stage: "ui_state",
      state,
    });
  }, [cardDetails, isPendingWallet, provisioning, walletEligible]);

  useEffect(() => {
    if (Platform.OS === "web" || cardDetails?.lastFour.length !== 4) return;
    const lastFour = cardDetails.lastFour;
    let mounted = true;
    let cleanup: (() => void) | undefined;
    traceWallet(Platform.OS === "ios" ? "apple" : "google", "sdk_init", initMeaWallet, { stage: "sdk_init" })
      .then((nextWallet) => {
        if (!mounted) return;
        setSdk((current) => current ?? nextWallet);
        if (Platform.OS === "ios") {
          const subscription = nextWallet.default.ApplePay.registerDataChangedListener(() => {
            syncWalletEligibility(lastFour).catch(reportError);
          });
          cleanup = () => {
            nextWallet.default.ApplePay.removeDataChangedListener(subscription);
          };
          return;
        }
        const subscription = nextWallet.default.GooglePay.registerDataChangedListener(() => {
          syncWalletEligibility(lastFour).catch(reportError);
        });
        cleanup = () => nextWallet.default.GooglePay.removeDataChangedListener(subscription);
      })
      .catch((error: unknown) => reportWalletError(error, Platform.OS === "ios" ? "apple" : "google", "eligibility"));
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [cardDetails?.lastFour]);

  const withWalletProvisioning = async (
    provider: WalletProvider,
    operation: Exclude<WalletOperation, "eligibility">,
    work: () => Promise<boolean>,
  ) => {
    if (walletInFlightRef.current) return;
    walletInFlightRef.current = true;
    setProvisioning(true);
    reportWalletDiagnostic({
      context: {
        apple_status: walletEligible?.apple ?? "unknown",
        google_status: walletEligible?.google ?? "unknown",
        google_token_available: walletEligible?.googleToken !== null && walletEligible?.googleToken !== undefined,
      },
      stage: "button",
      state: "button_pressed",
      provider,
      operation,
    });
    reportWalletDiagnosticsSafely(() =>
      addBreadcrumb({
        category: "wallet.provisioning",
        data: { operation, provider },
        message: `${provider} ${operation} started`,
      }),
    );
    try {
      const completed = await traceWallet(provider, operation, work, {
        forceTransaction: true,
        stage: "provisioning",
      });
      reportWalletDiagnostic({
        context: { card_added: completed },
        level: completed ? "info" : "warning",
        stage: "provisioning",
        state: completed ? "succeeded" : "not_added",
        provider,
        operation,
      });
      if (completed) {
        reportWalletDiagnosticsSafely(() =>
          addBreadcrumb({
            category: "wallet.provisioning",
            data: { operation, provider },
            message: `${provider} ${operation} completed`,
          }),
        );
        Alert.alert(t("Card added"), t("Your card was added to your wallet. Follow any remaining steps if prompted."));
      }
    } catch (error) {
      const classification = classifyError(error);
      if (!classification.walletCancelled) {
        reportWalletError(error, provider, operation);
        Alert.alert(t("Something went wrong. Please try again."));
      }
    } finally {
      walletInFlightRef.current = false;
      setProvisioning(false);
    }
  };

  const AddPassButton = Platform.OS === "ios" ? sdk?.default.ApplePay.AddPassButton : undefined;
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
          refreshControl={<RefreshControl onRefresh={refresh} />}
        >
          <View fullScreen>
            <View flex={1} gap="$s5" paddingBottom="$s5">
              <View alignItems="center" gap="$s4" width="100%" backgroundColor="$backgroundSoft" padded>
                <XStack gap="$s3_5" justifyContent="space-between" alignItems="center" width="100%">
                  <Text fontSize={20} fontWeight="bold">
                    {t("My Exa Card")}
                  </Text>
                  <View display="flex" flexDirection="row" alignItems="center" gap="$s4">
                    <IconButton
                      icon={hidden ? EyeOff : Eye}
                      color="$uiNeutralSecondary"
                      aria-label={hidden ? t("Show sensitive") : t("Hide sensitive")}
                      onPress={() => {
                        queryClient.setQueryData(["settings", "sensitive"], !hidden);
                      }}
                    />
                    <IconButton
                      icon={CircleHelp}
                      color="$uiNeutralSecondary"
                      aria-label={t("Help")}
                      onPress={() => {
                        presentArticle("10022626").catch(reportError);
                      }}
                    />
                  </View>
                </XStack>
                {!isPendingKYC && !cardDetails && (usdBalance === 0n || !isKYCApproved) && (
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
                  revealing={isRevealing || isGeneratingCard || beginKYC.isPending}
                  frozen={displayStatus === "FROZEN"}
                  onPress={() => {
                    if (isRevealing || beginKYC.isPending) return;
                    if (isGeneratingCard) {
                      refetchCard()
                        .then(({ data, error }) => {
                          if (error) reportError(error);
                          else if (data) queryClient.setQueryData(["card-details-open"], true);
                          else setSignal((previous) => previous + 1);
                        })
                        .catch(reportError);
                      return;
                    }
                    revealCard().catch(reportError);
                  }}
                />
                {Platform.OS !== "web" &&
                cardDetails &&
                !isPendingWallet &&
                walletEligible &&
                (walletEligible.apple !== "hidden" || walletEligible.google !== "hidden") ? (
                  <XStack alignSelf="center" alignItems="center" justifyContent="center">
                    {provisioning ? (
                      <Spinner color="$interactiveTextBrandDefault" />
                    ) : (
                      <>
                        {AddPassButton && walletEligible.apple === "cta" ? (
                          <AddPassButton
                            style={{ height: 44, width: 180 }}
                            addPassButtonStyle="black"
                            onPress={() => {
                              withWalletProvisioning("apple", "add_payment_pass", async () => {
                                const nextWallet = sdk ?? (await initMeaWallet());
                                const { cardId, cardSecret } = await queryClient.fetchQuery<{
                                  cardId: string;
                                  cardSecret: string;
                                }>({
                                  queryKey: ["card", "provisioning"],
                                  staleTime: 0,
                                });
                                const response = await nextWallet.default.ApplePay.initializeOemTokenization(
                                  nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
                                );
                                const activationState =
                                  await nextWallet.default.ApplePay.showAddPaymentPassView(response);
                                await syncWalletEligibility(cardDetails.lastFour);
                                return [
                                  nextWallet.MppPassActivationState.ACTIVATED,
                                  nextWallet.MppPassActivationState.ACTIVATING,
                                  nextWallet.MppPassActivationState.REQUIRES_ACTIVATION,
                                ].includes(activationState);
                              }).catch(reportError);
                            }}
                          />
                        ) : null}
                        {walletEligible.google === "cta" ? (
                          <Pressable
                            accessibilityLabel={t("Add to Google Wallet")}
                            accessibilityRole="button"
                            hitSlop={8}
                            style={{ height: googleWalletButton.height, width: googleWalletButton.width }}
                            onPress={() => {
                              withWalletProvisioning(
                                "google",
                                walletEligible.googleToken ? "tokenize" : "push_card",
                                async () => {
                                  const nextWallet = sdk ?? (await initMeaWallet());
                                  if (walletEligible.googleToken) {
                                    await nextWallet.default.GooglePay.tokenize(
                                      walletEligible.googleToken,
                                      cardDetails.displayName,
                                    );
                                    await syncWalletEligibility(cardDetails.lastFour);
                                    return true;
                                  }
                                  const { cardId, cardSecret } = await queryClient.fetchQuery<{
                                    cardId: string;
                                    cardSecret: string;
                                  }>({
                                    queryKey: ["card", "provisioning"],
                                    staleTime: 0,
                                  });
                                  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by MeaWallet legacy push provisioning
                                  await nextWallet.default.GooglePay.pushCard(
                                    nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
                                    cardDetails.displayName,
                                    {},
                                  );
                                  await syncWalletEligibility(cardDetails.lastFour);
                                  return true;
                                },
                              ).catch(reportError);
                            }}
                          >
                            <GoogleWalletButton height={googleWalletButton.height} width={googleWalletButton.width} />
                          </Pressable>
                        ) : null}
                        {walletEligible.google === "added" ? (
                          <XStack
                            aria-label={t("Added to Google Wallet")}
                            alignItems="center"
                            gap="$s3_5"
                            justifyContent="center"
                          >
                            <GoogleWalletIcon height={24} width={24} />
                            <View width={1} height={24} backgroundColor="$borderNeutralSoft" />
                            <Text caption color="$uiNeutralPlaceholder">
                              {t("Added to Google Wallet")}
                            </Text>
                          </XStack>
                        ) : null}
                      </>
                    )}
                  </XStack>
                ) : null}
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
                      selectionAsync().catch(reportError);
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
                        role="switch"
                        aria-checked={displayStatus === "FROZEN"}
                        aria-label={t("Freeze card")}
                        aria-disabled={isFetchingCard || isSettingCardStatus}
                        justifyContent="space-between"
                        paddingVertical="$s4"
                        alignItems="center"
                        cursor="pointer"
                        onPress={() => {
                          if (isFetchingCard || isSettingCardStatus) return;
                          selectionAsync().catch(reportError);
                          if (cardDetails.status === "FROZEN") {
                            changeCardStatus("ACTIVE");
                            return;
                          }
                          setFreezeConfirmOpen(true);
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
                            {t("Freeze card")}
                          </Text>
                        </XStack>
                        <Switch checked={displayStatus === "FROZEN"}>
                          <Switch.Thumb />
                        </Switch>
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
                          selectionAsync().catch(reportError);
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
                      selectionAsync().catch(reportError);
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
                          <Text caption emphasized color="$uiBrandSecondary">
                            {`$${(limit - totalSpent).toLocaleString(language, {
                              style: "decimal",
                              maximumFractionDigits: 0,
                            })}`}
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
              <View paddingHorizontal="$s4" gap="$s5">
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
                      i18nKey="The Exa Card is issued by Third National pursuant to a license from Visa. Any credit issued by <link>Exactly Protocol</link> subject to its separate terms and conditions. Third National is not a party to any agreement with <link>Exactly Protocol</link> and is not responsible for any funding or credit arrangement between user and <link>Exactly Protocol</link>."
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
        <CardDetailsSheet
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
        <CardFreezeSheet
          open={freezeConfirmOpen}
          onClose={() => {
            setFreezeConfirmOpen(false);
          }}
          onConfirm={() => {
            setFreezeConfirmOpen(false);
            changeCardStatus("FROZEN");
          }}
        />
        <TimeoutSheet
          failureCount={generateCardFailures}
          signal={signal}
          pending={isGeneratingCard}
          submittedAt={generateSubmittedAt}
        />
      </View>
    </SafeView>
  );
}

function reportWalletDiagnosticsSafely(report: () => void) {
  try {
    report();
  } catch {
    // Diagnostics must never change wallet behavior.
  }
}

async function runWalletWithDiagnostics<T>(
  trace: (run: () => Promise<T>) => Promise<T>,
  work: () => Promise<T>,
): Promise<T> {
  let callbackResult: T | undefined;
  let callbackError: unknown;
  const callbackState = { value: "not_started" as "completed" | "failed" | "not_started" | "running" };

  try {
    return await trace(async () => {
      callbackState.value = "running";
      try {
        callbackResult = await work();
        callbackState.value = "completed";
        return callbackResult;
      } catch (error) {
        callbackError = error;
        callbackState.value = "failed";
        throw error;
      }
    });
  } catch (error) {
    switch (callbackState.value) {
      case "not_started":
        return work();
      case "completed":
        return callbackResult as T;
      case "failed":
        throw callbackError;
      case "running":
        throw error;
    }
  }
}

function reportWalletError(
  error: unknown,
  provider: WalletProvider,
  operation: WalletOperation,
  context?: WalletDiagnosticContext,
) {
  reportWalletDiagnosticsSafely(() =>
    withScope((scope) => {
      scope.setTag("wallet_platform", Platform.OS);
      scope.setTag("wallet_provider", provider);
      scope.setTag("wallet_operation", operation);
      scope.setContext("wallet_provisioning", { operation, platform: Platform.OS, provider, ...context });
      reportError(error);
    }),
  );
}

function reportGoogleWalletStatus(
  reason: "added" | "cta" | "token_state_hidden" | "wallet_unavailable",
  tokenStates?: (number | string)[],
) {
  reportWalletDiagnosticsSafely(() =>
    withScope((scope) => {
      scope.setTag("wallet_platform", Platform.OS);
      scope.setTag("wallet_provider", "google");
      scope.setTag("wallet_operation", "eligibility");
      scope.setTag("wallet_eligibility_reason", reason);
      scope.setContext("wallet_eligibility", {
        platform: Platform.OS,
        provider: "google",
        reason,
        ...(tokenStates === undefined ? {} : { token_states: tokenStates }),
      });
      captureMessage("google wallet eligibility", reason === "added" || reason === "cta" ? "info" : "warning");
    }),
  );
}

function reportWalletDiagnostic({
  context,
  level = "info",
  operation,
  provider,
  stage,
  state,
}: {
  context?: WalletDiagnosticContext;
  level?: "info" | "warning";
  operation?: WalletDiagnosticOperation;
  provider?: WalletProvider;
  stage: WalletDiagnosticStage;
  state:
    | "button_pressed"
    | "cancelled"
    | "card_details_missing"
    | "eligibility_pending"
    | "eligibility_unavailable"
    | "failed"
    | "google_button_visible"
    | "google_wallet_added"
    | "not_added"
    | "provisioning_spinner"
    | "started"
    | "succeeded"
    | "wallet_row_hidden";
}) {
  const data = Object.fromEntries(
    Object.entries({ operation, provider, stage, state, ...context }).filter(([, value]) => value !== undefined),
  );
  reportWalletDiagnosticsSafely(() =>
    addBreadcrumb({ category: "wallet.diagnostic", data, message: `${stage} ${state}` }),
  );
  reportWalletDiagnosticsSafely(() =>
    withScope((scope) => {
      scope.setTag("wallet_diagnostic", "true");
      scope.setTag("wallet_platform", Platform.OS);
      scope.setTag("wallet_stage", stage);
      scope.setTag("wallet_state", state);
      if (provider) scope.setTag("wallet_provider", provider);
      if (operation) scope.setTag("wallet_operation", operation);
      scope.setContext("wallet_diagnostic", { platform: Platform.OS, ...data });
      captureMessage(`wallet provisioning diagnostic: ${stage} ${state}`, level);
    }),
  );
}

function traceWallet<T>(
  provider: WalletProvider,
  operation: WalletDiagnosticOperation,
  work: () => Promise<T>,
  options: {
    forceTransaction?: boolean;
    stage: WalletDiagnosticStage;
  },
) {
  const { stage } = options;
  return runWalletWithDiagnostics(
    (run) =>
      startSpan(
        {
          name: `wallet ${stage}`,
          op: `wallet.${stage}`,
          forceTransaction: options.forceTransaction,
          attributes: {
            "wallet.operation": operation,
            "wallet.platform": Platform.OS,
            "wallet.provider": provider,
          },
        },
        async (span) => {
          reportWalletDiagnostic({ provider, operation, stage, state: "started" });
          try {
            const result = await run();
            const outcome =
              result === false ? (operation === "wallet_availability" ? "unavailable" : "not_added") : "succeeded";
            reportWalletDiagnosticsSafely(() => {
              span.setAttribute("wallet.outcome", outcome);
              span.setStatus({ code: 1, message: outcome });
            });
            return result;
          } catch (error) {
            const cancelled = classifyError(error).walletCancelled;
            reportWalletDiagnosticsSafely(() => {
              span.setAttribute("wallet.outcome", cancelled ? "cancelled" : "failed");
              span.setStatus({ code: cancelled ? 1 : 2, message: cancelled ? "cancelled" : "failed" });
            });
            reportWalletDiagnostic({
              context: { error_kind: cancelled ? "cancelled" : "failed" },
              provider,
              operation,
              stage,
              state: cancelled ? "cancelled" : "failed",
            });
            throw error;
          }
        },
      ),
    work,
  );
}
