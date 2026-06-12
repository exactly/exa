import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Alert, AppState, NativeEventEmitter, NativeModules, Platform, Pressable, RefreshControl } from "react-native";

import { selectionAsync } from "expo-haptics";
import { useRouter } from "expo-router";

import { ChevronRight, CircleHelp, CreditCard, DollarSign, Eye, EyeOff, Hash, Snowflake } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, Spinner, Square, XStack, YStack } from "tamagui";

import { useMutation, useQuery } from "@tanstack/react-query";
import { boolean, object, optional, safeParse, string } from "valibot";

import accountInit from "@exactly/common/accountInit";
import chain, { marketUSDCAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import CardDetails from "./CardDetails";
import CardDisclaimer from "./CardDisclaimer";
import CardFreezeSheet from "./CardFreezeSheet";
import CardPIN from "./CardPIN";
import ExaCard from "./exa-card/ExaCard";
import SpendingLimits from "./SpendingLimits";
import VerificationFailure from "./VerificationFailure";
import GoogleWalletButtonEs from "../../assets/images/google-wallet-button-es.svg";
import GoogleWalletButtonPt from "../../assets/images/google-wallet-button-pt.svg";
import GoogleWalletButtonEn from "../../assets/images/google-wallet-button.svg";
import { presentArticle } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError, { classifyError } from "../../utils/reportError";
import {
  APIError,
  createCard,
  setCardStatus,
  type CardActivity,
  type CardDetails as CardDetailsData,
  type KYCStatus,
} from "../../utils/server";
import useAccount from "../../utils/useAccount";
import useAsset from "../../utils/useAsset";
import useBeginKYC from "../../utils/useBeginKYC";
import useMarkets from "../../utils/useMarkets";
import useTabPress from "../../utils/useTabPress";
import IconButton from "../shared/IconButton";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import PluginUpgrade from "../shared/PluginUpgrade";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Switch from "../shared/Switch";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";

type GoogleToken = Record<string, unknown> & {
  isSelectedAsDefault: boolean;
  paymentNetwork: string;
  tokenId: string;
  tokenState: string;
};
type GoogleWalletButtonAsset = { Component: typeof GoogleWalletButtonEn; height: number; width: number };
type Wallet = {
  default: {
    ApplePay: {
      AddPassButton?: React.ComponentType<{
        addPassButtonStyle: "black";
        onPress: () => void;
        style: { height: number; width: number };
      }>;
      canAddPaymentPass(): Promise<boolean>;
      canAddPaymentPassWithPrimaryAccountIdentifier(primaryAccountIdentifier: string): Promise<boolean>;
      canAddRemoteSecureElementPassWithPrimaryAccountIdentifier(primaryAccountIdentifier: string): Promise<boolean>;
      canAddSecureElementPassWithPrimaryAccountIdentifier(primaryAccountIdentifier: string): Promise<boolean>;
      initializeOemTokenization(cardData: unknown): Promise<{
        localizedDescription?: string;
        networkName?: string;
        primaryAccountIdentifier?: string;
        primaryAccountSuffix?: string;
        tokenizationReceipt?: string;
        validFor?: number;
      }>;
      isPassLibraryAvailable(): Promise<boolean>;
      isWatchPaired(): Promise<boolean>;
      registerDataChangedListener(listener: (data?: unknown) => void): unknown;
      remoteSecureElementPassExistsWithPrimaryAccountIdentifier(primaryAccountIdentifier: string): Promise<boolean>;
      removeDataChangedListener(subscription: unknown): void;
      secureElementPassExistsWithPrimaryAccountIdentifier(primaryAccountIdentifier: string): Promise<boolean>;
      setDebugLoggingEnabled(enabled: boolean): void;
      showAddPaymentPassView(response: unknown): Promise<string>;
    };
    GooglePay: {
      checkWalletForCardSuffix(cardSuffix: string): Promise<unknown>;
      isWalletAvailable(): Promise<boolean>;
      pushCard(cardData: unknown, cardDisplayName: string, userAddress: null | object): Promise<unknown>;
      registerDataChangedListener(listener: () => void): unknown;
      removeDataChangedListener(subscription: unknown): void;
      tokenize(token: GoogleToken, cardDisplayName: string): Promise<void>;
    };
    initialize(): Promise<void>;
  };
  MppCardDataParameters: {
    withCardSecret(cardId: string, cardSecret: string): unknown;
  };
};
type WalletEligibility = { apple: boolean; google: "cta" | "hidden"; googleToken: GoogleToken | null };
const hiddenWallet = { apple: false, google: "hidden", googleToken: null } satisfies WalletEligibility;
const googleWalletButtonEn = {
  Component: GoogleWalletButtonEn,
  height: 32,
  width: 116,
} satisfies GoogleWalletButtonAsset;
const googleWalletButtons: Record<string, GoogleWalletButtonAsset> = {
  en: googleWalletButtonEn,
  es: { Component: GoogleWalletButtonEs, height: 32, width: 139 },
  pt: { Component: GoogleWalletButtonPt, height: 32, width: 140 },
};

const provisioningSdk = Platform.OS === "web" ? undefined : (require("@meawallet/react-native-mpp") as Wallet); // eslint-disable-line unicorn/prefer-module
let walletInitPromise: Promise<Wallet> | undefined;
const primaryAccountIdentifiers = new Map<string, string>();
const redactedWalletKeys = new Set([
  "activationData",
  "cardNumber",
  "cardSecret",
  "certificates",
  "cvv",
  "encryptedPassData",
  "ephemeralPublicKey",
  "nonce",
  "nonceSignature",
  "pan",
  "tokenizationReceipt",
  "wrappedKey",
]);

function redactWalletValue(value: unknown, key?: string, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (key !== undefined && redactedWalletKeys.has(key)) return `[redacted:${value.length}]`;
    if (key?.toLowerCase().includes("identifier")) return `…${value.slice(-8)}`;
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }
  if (value instanceof Error) {
    return redactWalletValue(
      {
        cause: value.cause,
        message: value.message,
        name: value.name,
      },
      key,
      seen,
    );
  }
  if (Array.isArray(value)) return value.map((item) => redactWalletValue(item, key, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[circular]";
    seen.add(value);
    const result: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      result[entryKey] = redactWalletValue(entryValue, entryKey, seen);
    }
    return result;
  }
  return "[unsupported]";
}

function walletLog(event: string, details?: Record<string, unknown>) {
  console.log(`[wallet] ${JSON.stringify(redactWalletValue(details ? { event, ...details } : { event }))}`); // eslint-disable-line no-console -- temporary provisioning trace
}

function summarizeWalletError(error: unknown) {
  const classification = classifyError(error);
  const value =
    typeof error === "object" && error !== null
      ? (error as { cause?: unknown; code?: unknown; domain?: unknown; message?: unknown; name?: unknown })
      : undefined;
  return redactWalletValue({
    cause: value?.cause,
    classification: {
      known: classification.known,
      knownInfo: classification.knownInfo,
      knownWarning: classification.knownWarning,
      walletCancelled: classification.walletCancelled,
      walletRejected: classification.walletRejected,
    },
    code: value?.code,
    domain: value?.domain,
    message: error instanceof Error ? error.message : (value?.message ?? String(error)),
    name: error instanceof Error ? error.name : value?.name,
    userInfo: "userInfo" in (value ?? {}) ? (value as { userInfo?: unknown }).userInfo : undefined,
  }) as Record<string, unknown>;
}

async function traceWalletCall<T>(event: string, work: () => Promise<T>, details?: Record<string, unknown>) {
  const startedAt = Date.now();
  walletLog(`${event}.start`, details);
  try {
    const result = await work();
    walletLog(`${event}.success`, { ...details, durationMs: Date.now() - startedAt, result });
    return result;
  } catch (error) {
    walletLog(`${event}.error`, { ...details, durationMs: Date.now() - startedAt, error: summarizeWalletError(error) });
    throw error;
  }
}
function getApplePayEmitter() {
  if (Platform.OS !== "ios" || !NativeModules.ApplePay) return;
  try {
    return new NativeEventEmitter(NativeModules.ApplePay as never);
  } catch (error) {
    walletLog("apple.nativeEmitter.error", { error: summarizeWalletError(error) });
  }
}

function enableWalletDebugLogging(wallet: Wallet) {
  if (Platform.OS !== "ios") return;
  try {
    wallet.default.ApplePay.setDebugLoggingEnabled(true);
    walletLog("apple.debug.enabled", { enabled: true });
  } catch (error) {
    walletLog("apple.debug.enable.error", { error: summarizeWalletError(error) });
  }
}

const activeTokenStates = new Set(["TOKEN_STATE_ACTIVE"]);
const pushTokenStates = new Set(["TOKEN_STATE_NOT_FOUND", "TOKEN_STATE_UNTOKENIZED"]); // cspell:ignore untokenized
function isActiveToken(token: GoogleToken) {
  return activeTokenStates.has(token.tokenState);
}

function needsPushToken(token: GoogleToken) {
  return pushTokenStates.has(token.tokenState);
}

function initWallet() {
  if (!provisioningSdk) return Promise.reject(new Error("wallet unavailable on web"));
  walletInitPromise ??= provisioningSdk.default
    .initialize()
    .then(() => {
      enableWalletDebugLogging(provisioningSdk);
      return provisioningSdk;
    })
    .catch((error: unknown) => {
      walletLog("wallet.initialize.error", { error: summarizeWalletError(error) });
      walletInitPromise = undefined;
      throw error;
    });
  return walletInitPromise;
}

function syncWalletEligibility(lastFour: string | undefined, reason: string) {
  if (Platform.OS === "web" || lastFour?.length !== 4) return Promise.resolve();
  walletLog("wallet.eligibility.sync", { lastFour, reason });
  return queryClient
    .refetchQueries({ exact: true, queryKey: ["wallet", "eligible", lastFour] })
    .catch((error: unknown) => {
      walletLog("wallet.eligibility.sync.error", { error: summarizeWalletError(error), lastFour, reason });
      reportError(error);
    });
}

export default function Card() {
  const toast = useToastController();
  const [displayPIN, setDisplayPIN] = useState(false);
  const router = useRouter();
  const {
    t,
    i18n: { language },
  } = useTranslation();
  const googleWalletButton = googleWalletButtons[language.split("-")[0] ?? "en"] ?? googleWalletButtonEn;
  const GoogleWalletButton = googleWalletButton.Component;
  const [disclaimerShown, setDisclaimerShown] = useState(false);
  const [verificationFailureShown, setVerificationFailureShown] = useState(false);
  const [freezeConfirmOpen, setFreezeConfirmOpen] = useState(false);

  const { data: cardDetailsOpen } = useQuery<boolean>({ queryKey: ["card-details-open"] });
  const [spendingLimitsOpen, setSpendingLimitsOpen] = useState(false);
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });

  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: purchases, isFetching: isFetchingPurchases } = useQuery<CardActivity[]>({
    queryKey: ["activity", "card"],
  });

  const {
    data: cardDetails,
    refetch: refetchCard,
    isFetching: isFetchingCard,
  } = useQuery<CardDetailsData>({ queryKey: ["card", "details"], retry: false, gcTime: 0, staleTime: 0 });

  const limit = cardDetails?.limit.amount ? cardDetails.limit.amount / 100 : undefined;
  const weeklyPurchases = purchases
    ? purchases.filter((item): item is Extract<CardActivity, { type: "panda" }> => {
        if (item.type !== "panda" || item.status === "declined") return false;
        const elapsedTime = (Date.now() - new Date(item.timestamp).getTime()) / 1000;
        return elapsedTime <= 604_800;
      })
    : [];
  const totalSpent = weeklyPurchases.reduce((accumulator, item) => accumulator + item.usdAmount, 0);

  const { queryKey, isFetching: isFetchingAsset } = useAsset(marketUSDCAddress);
  const { address } = useAccount();
  const {
    data: kycStatus,
    isFetching: isFetchingKYC,
    isPending: isPendingKYC,
  } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"] });
  const isKYCApproved = Boolean(
    kycStatus && "code" in kycStatus && (kycStatus.code === "ok" || kycStatus.code === "legacy kyc"),
  );
  const { refetch: refetchInstalledPlugins, isFetching: isFetchingPlugins } =
    useReadUpgradeableModularAccountGetInstalledPlugins({
      address,
      chainId: chain.id,
      factory: credential?.factory,
      factoryData: credential && accountInit(credential),
      query: { enabled: !!address && !!credential },
    });

  const { markets, refetch: refetchMarkets, isFetching: isFetchingMarkets } = useMarkets();

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
    queryClient.invalidateQueries({ queryKey: ["activity", "card"], exact: true }).catch(reportError);
    queryClient.invalidateQueries({ queryKey: ["kyc", "status"], exact: true }).catch(reportError);
    if (address) refetchMarkets().catch(reportError);
    if (address && credential) refetchInstalledPlugins().catch(reportError);
    syncWalletEligibility(cardDetails?.lastFour, "screen.refresh").catch(() => undefined);
    queryClient.refetchQueries({ queryKey }).catch(reportError);
  };
  useTabPress("card", () => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
    refresh();
  });

  const beginKYC = useBeginKYC();

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
            native: true,
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
            native: true,
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
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
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

  const [sdk, setSdk] = useState<null | Wallet>(null);
  const [provisioning, setProvisioning] = useState(false);
  const walletInFlightRef = useRef(false);
  const walletAttemptRef = useRef<string | undefined>(undefined);
  const { data: walletEligible, isPending: isPendingWallet } = useQuery<WalletEligibility>({
    queryKey: ["wallet", "eligible", cardDetails?.lastFour],
    enabled: Platform.OS !== "web" && cardDetails?.lastFour.length === 4,
    queryFn: async () => {
      const lastFour = cardDetails?.lastFour;
      if (!lastFour || Platform.OS === "web") return hiddenWallet;
      walletLog("wallet.eligibility.start", { lastFour });
      const nextWallet = await initWallet();
      if (Platform.OS === "ios") {
        try {
          const [{ cardId, cardSecret }, available, canAdd, watchPaired] = await Promise.all([
            traceWalletCall(
              "apple.provisioning.fetch",
              () =>
                queryClient.fetchQuery<{ cardId: string; cardSecret: string }>({
                  queryKey: ["card", "provisioning"],
                  staleTime: 0,
                }),
              { reason: "eligibility" },
            ),
            traceWalletCall(
              "apple.isPassLibraryAvailable",
              () => nextWallet.default.ApplePay.isPassLibraryAvailable(),
              {
                reason: "eligibility",
              },
            ),
            traceWalletCall("apple.canAddPaymentPass", () => nextWallet.default.ApplePay.canAddPaymentPass(), {
              reason: "eligibility",
            }),
            traceWalletCall("apple.isWatchPaired", () => nextWallet.default.ApplePay.isWatchPaired(), {
              reason: "eligibility",
            }).catch(() => undefined),
          ]);
          const cachedPrimaryAccountIdentifier = primaryAccountIdentifiers.get(cardId);
          walletLog("apple.eligibility.base", {
            available,
            canAdd,
            cardId,
            hasCachedPrimaryAccountIdentifier: cachedPrimaryAccountIdentifier !== undefined,
            lastFour,
            watchPaired,
          });
          if (!available || !canAdd) return hiddenWallet;
          const response =
            cachedPrimaryAccountIdentifier === undefined
              ? await traceWalletCall(
                  "apple.initializeOemTokenization",
                  () =>
                    nextWallet.default.ApplePay.initializeOemTokenization(
                      nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
                    ),
                  { cardId, reason: "eligibility" },
                )
              : { primaryAccountIdentifier: cachedPrimaryAccountIdentifier };
          const primaryAccountIdentifier = response.primaryAccountIdentifier;
          if (primaryAccountIdentifier) {
            primaryAccountIdentifiers.set(cardId, primaryAccountIdentifier);
            walletLog("apple.eligibility.identifier", {
              cardId,
              lastFour,
              primaryAccountIdentifier,
              usedCachedPrimaryAccountIdentifier: cachedPrimaryAccountIdentifier !== undefined,
            });
            const secureElementPassExists = await traceWalletCall(
              "apple.secureElementPassExists",
              () =>
                nextWallet.default.ApplePay.secureElementPassExistsWithPrimaryAccountIdentifier(
                  primaryAccountIdentifier,
                ),
              { primaryAccountIdentifier, reason: "eligibility" },
            );
            const [
              canAddByPrimaryAccountIdentifier,
              canAddRemoteSecureElement,
              canAddSecureElement,
              remoteSecureElementPassExists,
            ] = await Promise.all([
              traceWalletCall(
                "apple.canAddPaymentPassWithPrimaryAccountIdentifier",
                () =>
                  nextWallet.default.ApplePay.canAddPaymentPassWithPrimaryAccountIdentifier(primaryAccountIdentifier),
                { primaryAccountIdentifier, reason: "eligibility" },
              ).catch(() => undefined),
              traceWalletCall(
                "apple.canAddRemoteSecureElementPassWithPrimaryAccountIdentifier",
                () =>
                  nextWallet.default.ApplePay.canAddRemoteSecureElementPassWithPrimaryAccountIdentifier(
                    primaryAccountIdentifier,
                  ),
                { primaryAccountIdentifier, reason: "eligibility" },
              ).catch(() => undefined),
              traceWalletCall(
                "apple.canAddSecureElementPassWithPrimaryAccountIdentifier",
                () =>
                  nextWallet.default.ApplePay.canAddSecureElementPassWithPrimaryAccountIdentifier(
                    primaryAccountIdentifier,
                  ),
                { primaryAccountIdentifier, reason: "eligibility" },
              ).catch(() => undefined),
              traceWalletCall(
                "apple.remoteSecureElementPassExistsWithPrimaryAccountIdentifier",
                () =>
                  nextWallet.default.ApplePay.remoteSecureElementPassExistsWithPrimaryAccountIdentifier(
                    primaryAccountIdentifier,
                  ),
                { primaryAccountIdentifier, reason: "eligibility" },
              ).catch(() => undefined),
            ]);
            walletLog("apple.eligibility.diagnostics", {
              canAddByPrimaryAccountIdentifier,
              canAddRemoteSecureElement,
              canAddSecureElement,
              lastFour,
              remoteSecureElementPassExists,
              secureElementPassExists,
            });
            const canAddLocalSecureElement = canAddSecureElement === true || canAddByPrimaryAccountIdentifier === true;
            const localSecureElementUnavailable =
              canAddSecureElement === false && canAddByPrimaryAccountIdentifier === false;
            return {
              apple: canAddLocalSecureElement || (!localSecureElementUnavailable && !secureElementPassExists),
              google: "hidden",
              googleToken: null,
            };
          }
          walletLog("apple.eligibility.identifier.missing", {
            cardId,
            keys: Object.keys(response),
            lastFour,
            primaryAccountSuffix: response.primaryAccountSuffix,
            tokenizationReceiptLength: response.tokenizationReceipt?.length,
            validFor: response.validFor,
          });
          return { apple: true, google: "hidden", googleToken: null };
        } catch (error) {
          walletLog("apple.eligibility.error", { error: summarizeWalletError(error), lastFour });
          reportError(error);
          return { apple: true, google: "hidden", googleToken: null };
        }
      }
      if (Platform.OS !== "android") return hiddenWallet;
      return nextWallet.default.GooglePay.isWalletAvailable()
        .then(async (available) => {
          if (!available) return hiddenWallet;
          const token = await nextWallet.default.GooglePay.checkWalletForCardSuffix(lastFour).catch(
            (error: unknown) => {
              const code =
                typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
                  ? error.code
                  : undefined;
              const walletApiCode =
                typeof error === "object" &&
                error !== null &&
                "userInfo" in error &&
                typeof error.userInfo === "object" &&
                error.userInfo !== null &&
                "code" in error.userInfo &&
                typeof error.userInfo.code === "number"
                  ? error.userInfo.code
                  : undefined;
              if (code === "GOOGLE_PAY_TOKEN_NOT_FOUND" || walletApiCode === 702) {
                walletLog("google.eligibility.tokenMissing", { code, lastFour, walletApiCode });
                return null;
              }
              reportError(error);
            },
          );
          if (token === undefined) return hiddenWallet;
          const tokens = (Array.isArray(token) ? token : [token])
            .map((item) => {
              if (typeof item !== "object" || item === null) return null;
              const parsed = safeParse(
                object({
                  isDefaultToken: optional(boolean()),
                  issuerTokenId: string(),
                  paymentNetwork: string(),
                  tokenState: string(),
                }),
                item,
              );
              return parsed.success
                ? {
                    ...item,
                    isSelectedAsDefault: parsed.output.isDefaultToken ?? false,
                    paymentNetwork: parsed.output.paymentNetwork,
                    tokenId: parsed.output.issuerTokenId,
                    tokenState: parsed.output.tokenState,
                  }
                : null;
            })
            .filter((item): item is GoogleToken => item !== null);
          const verificationToken =
            tokens.find((item) => item.tokenState === "TOKEN_STATE_NEEDS_IDENTITY_VERIFICATION") ?? null;
          const googleHidden =
            tokens.some((item) => isActiveToken(item)) ||
            (!verificationToken && !tokens.every((item) => needsPushToken(item)));
          return {
            apple: false,
            google: googleHidden ? "hidden" : "cta",
            googleToken: googleHidden ? null : verificationToken,
          } satisfies WalletEligibility;
        })
        .catch((error: unknown) => {
          reportError(error);
          return hiddenWallet;
        });
    },
  });

  useEffect(() => {
    if (Platform.OS === "web" || cardDetails?.lastFour.length !== 4) return;
    const lastFour = cardDetails.lastFour;
    const subscription = AppState.addEventListener("change", (state) => {
      walletLog("wallet.appState", { lastFour, state });
      if (state !== "active") return;
      syncWalletEligibility(lastFour, "app.active").catch(() => undefined);
    });
    return () => {
      subscription.remove();
    };
  }, [cardDetails?.lastFour]);

  useEffect(() => {
    if (Platform.OS === "web" || cardDetails?.lastFour.length !== 4) return;
    const lastFour = cardDetails.lastFour;
    let mounted = true;
    let cleanup: (() => void) | undefined;
    initWallet()
      .then((nextWallet) => {
        if (!mounted) return;
        setSdk((current) => current ?? nextWallet);
        if (Platform.OS === "ios") {
          const traceSubscription = getApplePayEmitter()?.addListener("ApplePayTrace", (data) => {
            walletLog("apple.native", { lastFour, trace: data });
          });
          const subscription = nextWallet.default.ApplePay.registerDataChangedListener((data) => {
            walletLog("apple.dataChanged", { data, lastFour });
            syncWalletEligibility(lastFour, "apple.dataChanged").catch(() => undefined);
          });
          cleanup = () => {
            traceSubscription?.remove();
            nextWallet.default.ApplePay.removeDataChangedListener(subscription);
          };
          return;
        }
        const subscription = nextWallet.default.GooglePay.registerDataChangedListener(() => {
          walletLog("google.dataChanged", { lastFour });
          syncWalletEligibility(lastFour, "google.dataChanged").catch(() => undefined);
        });
        cleanup = () => nextWallet.default.GooglePay.removeDataChangedListener(subscription);
      })
      .catch((error: unknown) => {
        walletLog("wallet.listener.error", { error: summarizeWalletError(error), lastFour });
      });
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [cardDetails?.lastFour]);

  const withWalletProvisioning = <T,>(work: () => Promise<T>) => {
    const lastFour = cardDetails?.lastFour;
    if (walletInFlightRef.current) {
      walletLog("wallet.provisioning.ignored", { lastFour, reason: "in_flight" });
      return Promise.resolve();
    }
    const attempt = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    walletAttemptRef.current = attempt;
    walletInFlightRef.current = true;
    setProvisioning(true);
    walletLog("wallet.provisioning.start", { attempt, lastFour });
    return work()
      .then((result) => {
        walletLog("wallet.provisioning.success", {
          attempt,
          durationMs: Date.now() - startedAt,
          lastFour,
        });
        return result;
      })
      .catch((error: unknown) => {
        const classification = classifyError(error);
        walletLog("wallet.provisioning.error", {
          attempt,
          durationMs: Date.now() - startedAt,
          error: summarizeWalletError(error),
          lastFour,
        });
        if (classification.walletCancelled) {
          walletLog("wallet.provisioning.cancelled", {
            attempt,
            durationMs: Date.now() - startedAt,
            lastFour,
          });
          return;
        }
        reportError(error);
        throw error;
      })
      .finally(() => {
        walletLog("wallet.provisioning.finish", {
          attempt,
          durationMs: Date.now() - startedAt,
          lastFour,
        });
        walletAttemptRef.current = undefined;
        walletInFlightRef.current = false;
        setProvisioning(false);
      });
  };

  const addToAppleWallet = () =>
    withWalletProvisioning(async () => {
      walletLog("apple.add.start", { hasSdk: sdk !== null, lastFour: cardDetails?.lastFour });
      const nextWallet = sdk ?? (await initWallet());
      const { cardId, cardSecret } = await traceWalletCall(
        "apple.provisioning.fetch",
        () =>
          queryClient.fetchQuery<{ cardId: string; cardSecret: string }>({
            queryKey: ["card", "provisioning"],
            staleTime: 0,
          }),
        { reason: "add" },
      );
      const response = await traceWalletCall(
        "apple.initializeOemTokenization",
        () =>
          nextWallet.default.ApplePay.initializeOemTokenization(
            nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
          ),
        { cardId, reason: "add" },
      );
      walletLog("apple.add.tokenization", {
        cardId,
        hasPrimaryAccountIdentifier: response.primaryAccountIdentifier !== undefined,
        keys: Object.keys(response),
        primaryAccountIdentifier: response.primaryAccountIdentifier,
        primaryAccountSuffix: response.primaryAccountSuffix,
        tokenizationReceiptLength: response.tokenizationReceipt?.length,
        validFor: response.validFor,
      });
      const activationState = await traceWalletCall(
        "apple.showAddPaymentPassView",
        () => nextWallet.default.ApplePay.showAddPaymentPassView(response),
        { cardId, primaryAccountIdentifier: response.primaryAccountIdentifier, validFor: response.validFor },
      );
      walletLog("apple.add.result", { activationState, cardId, lastFour: cardDetails?.lastFour });
      if (cardDetails?.lastFour.length === 4) {
        queryClient.setQueryData<WalletEligibility>(["wallet", "eligible", cardDetails.lastFour], (current) => ({
          apple: false,
          google: current?.google ?? "hidden",
          googleToken: current?.googleToken ?? null,
        }));
      }
      await syncWalletEligibility(cardDetails?.lastFour, "apple.add.return");
      return activationState === "ACTIVATED";
    });

  const addToGoogleWallet = () =>
    withWalletProvisioning(async () => {
      const nextWallet = sdk ?? (await initWallet());
      const googleToken = walletEligible?.googleToken;
      if (googleToken) {
        await nextWallet.default.GooglePay.tokenize(googleToken, cardDetails?.displayName ?? "");
        if (cardDetails?.lastFour.length === 4) {
          queryClient.setQueryData<WalletEligibility>(["wallet", "eligible", cardDetails.lastFour], (current) => ({
            apple: current?.apple ?? false,
            google: "hidden",
            googleToken: null,
          }));
        }
        await syncWalletEligibility(cardDetails?.lastFour, "google.add.return");
        return true;
      }
      const { cardId, cardSecret } = await queryClient.fetchQuery<{ cardId: string; cardSecret: string }>({
        queryKey: ["card", "provisioning"],
        staleTime: 0,
      });
      await nextWallet.default.GooglePay.pushCard(
        nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
        cardDetails?.displayName ?? "",
        {},
      );
      if (cardDetails?.lastFour.length === 4) {
        queryClient.setQueryData<WalletEligibility>(["wallet", "eligible", cardDetails.lastFour], (current) => ({
          apple: current?.apple ?? false,
          google: "hidden",
          googleToken: null,
        }));
      }
      await syncWalletEligibility(cardDetails?.lastFour, "google.add.return");
      return true;
    });

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
          refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
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
                {!isPendingKYC && (usdBalance === 0n || !isKYCApproved) && (
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
                    if (isRevealing || isGeneratingCard || beginKYC.isPending) return;
                    revealCard().catch(reportError);
                  }}
                />
                {Platform.OS !== "web" &&
                cardDetails &&
                !isPendingWallet &&
                walletEligible &&
                (walletEligible.apple || walletEligible.google !== "hidden") ? (
                  <XStack alignSelf="center" alignItems="center" justifyContent="center">
                    {provisioning ? (
                      <Spinner color="$interactiveTextBrandDefault" />
                    ) : (
                      <>
                        {AddPassButton && walletEligible.apple ? (
                          <AddPassButton
                            style={{ height: 44, width: 180 }}
                            addPassButtonStyle="black"
                            onPress={() => {
                              addToAppleWallet()
                                .then((added) => {
                                  if (!added) return;
                                  Alert.alert(
                                    t("Card added"),
                                    t("Your card was added to your wallet. Follow any remaining steps if prompted."),
                                  );
                                })
                                .catch(() => undefined);
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
                              addToGoogleWallet()
                                .then((added) => {
                                  if (!added) return;
                                  Alert.alert(
                                    t("Card added"),
                                    t("Your card was added to your wallet. Follow any remaining steps if prompted."),
                                  );
                                })
                                .catch(() => undefined);
                            }}
                          >
                            <GoogleWalletButton height={googleWalletButton.height} width={googleWalletButton.width} />
                          </Pressable>
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
      </View>
    </SafeView>
  );
}
