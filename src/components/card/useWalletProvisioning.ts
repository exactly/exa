import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";

import { addBreadcrumb, captureMessage, startSpan, withScope } from "@sentry/react-native";
import { useQuery } from "@tanstack/react-query";
import { literal, object, safeParse, union } from "valibot";

import init from "../../utils/meaWallet";
import queryClient from "../../utils/queryClient";
import reportError, { classifyError } from "../../utils/reportError";

import type { CardDetails } from "../../utils/server";
import type * as MeaWallet from "@meawallet/react-native-mpp";
import type { TFunction } from "i18next";

type WalletStatus = "added" | "cta" | "hidden";
type WalletEligibility = {
  apple: WalletStatus;
  google: WalletStatus;
  googleToken: MeaWallet.GooglePayTokenInfo | null;
};
type WalletEligibilityReason = "added" | "cta" | "token_state_hidden" | "wallet_unavailable";
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
const primaryAccountIdentifiers = new Map<string, string>();
const reportedWalletStates = new Set<string>();

export default function useWalletProvisioning({
  address,
  cardDetails,
  t,
}: {
  address: string | undefined;
  cardDetails: CardDetails | undefined;
  t: TFunction;
}) {
  const [sdk, setSdk] = useState<null | typeof MeaWallet>(null);
  const [provisioning, setProvisioning] = useState(false);
  const walletInFlightRef = useRef(false);
  const reportedWalletUiStateRef = useRef<string | undefined>(undefined);
  const { data: walletEligible, isPending: isPendingWallet } = useQuery<WalletEligibility>({
    queryKey: ["wallet", "eligible", address, cardDetails?.lastFour],
    enabled: Platform.OS !== "web" && cardDetails?.lastFour.length === 4,
    queryFn: async () => {
      const lastFour = cardDetails?.lastFour;
      if (!lastFour || Platform.OS === "web") return hiddenWallet;
      function reportGoogleWalletStatus(reason: WalletEligibilityReason, tokenStates?: string[]) {
        const key = `${address ?? ""}:${lastFour}:${reason}:${tokenStates?.join(",") ?? ""}`;
        if (reportedWalletStates.has(key)) return;
        reportedWalletStates.add(key);
        reportWalletStatus(reason, tokenStates);
      }
      if (Platform.OS === "ios") {
        try {
          const nextWallet = await init();
          if (!(await nextWallet.default.ApplePay.isPassLibraryAvailable())) return hiddenWallet;
          if (!(await nextWallet.default.ApplePay.canAddPaymentPass())) return hiddenWallet;
          const primaryAccountIdentifierKey = `${address ?? ""}:${lastFour}`;
          let primaryAccountIdentifier = primaryAccountIdentifiers.get(primaryAccountIdentifierKey);
          if (primaryAccountIdentifier === undefined) {
            const { cardId, cardSecret } = await queryClient.fetchQuery<{
              cardId: string;
              cardSecret: string;
            }>({ queryKey: ["card", "provisioning"] });
            ({ primaryAccountIdentifier } = await nextWallet.default.ApplePay.initializeOemTokenization(
              nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
            ));
          }
          if (primaryAccountIdentifier) {
            primaryAccountIdentifiers.set(primaryAccountIdentifierKey, primaryAccountIdentifier);
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
      const nextWallet = await traceWallet("google", "sdk_init", init, { stage: "sdk_init" }).catch(
        (error: unknown) => {
          reportWalletError(error, "google", "eligibility", { google_eligibility_reason: "sdk_init_failed" });
        },
      );
      if (!nextWallet) return hiddenWallet;
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
              context: tokenLookupNotFound === true ? { google_eligibility_reason: "token_not_found" } : undefined,
              provider: "google",
              operation: "eligibility",
              stage: "token_lookup",
              state: tokenLookupNotFound === true ? "not_added" : "succeeded",
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
                    tokenState === GooglePayTokenState.TOKEN_STATE_UNTOKENIZED, // cspell:ignore UNTOKENIZED
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
      syncWalletEligibility(lastFour, address).catch(reportError);
    });
    return () => {
      subscription.remove();
    };
  }, [address, cardDetails?.lastFour, walletEligible]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const lastFourAvailable = cardDetails?.lastFour.length === 4;
    const state = lastFourAvailable
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
        card_details_ready: lastFourAvailable,
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
    traceWallet(Platform.OS === "ios" ? "apple" : "google", "sdk_init", init, { stage: "sdk_init" })
      .then((nextWallet) => {
        if (!mounted) return;
        setSdk((current) => current ?? nextWallet);
        if (Platform.OS === "ios") {
          const subscription = nextWallet.default.ApplePay.registerDataChangedListener(() => {
            syncWalletEligibility(lastFour, address).catch(reportError);
          });
          cleanup = () => {
            nextWallet.default.ApplePay.removeDataChangedListener(subscription);
          };
          return;
        }
        const subscription = nextWallet.default.GooglePay.registerDataChangedListener(() => {
          syncWalletEligibility(lastFour, address).catch(reportError);
        });
        cleanup = () => nextWallet.default.GooglePay.removeDataChangedListener(subscription);
      })
      .catch((error: unknown) => reportWalletError(error, Platform.OS === "ios" ? "apple" : "google", "eligibility"));
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [address, cardDetails?.lastFour]);

  const runWalletProvisioning = async (
    provider: "apple" | "google",
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
    addBreadcrumb({
      category: "wallet.provisioning",
      data: { operation, provider },
      message: `${provider} ${operation} started`,
    });
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
        addBreadcrumb({
          category: "wallet.provisioning",
          data: { operation, provider },
          message: `${provider} ${operation} completed`,
        });
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

  const addToAppleWallet = () =>
    runWalletProvisioning("apple", "add_payment_pass", async () => {
      const nextWallet = sdk ?? (await init());
      const { cardId, cardSecret } = await queryClient.fetchQuery<{
        cardId: string;
        cardSecret: string;
      }>({ queryKey: ["card", "provisioning"] });
      const response = await nextWallet.default.ApplePay.initializeOemTokenization(
        nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
      );
      const activationState = await nextWallet.default.ApplePay.showAddPaymentPassView(response);
      await syncWalletEligibility(cardDetails?.lastFour, address);
      return [
        nextWallet.MppPassActivationState.ACTIVATED,
        nextWallet.MppPassActivationState.ACTIVATING,
        nextWallet.MppPassActivationState.REQUIRES_ACTIVATION,
      ].includes(activationState);
    });

  const addToGoogleWallet = () =>
    runWalletProvisioning("google", walletEligible?.googleToken ? "tokenize" : "push_card", async () => {
      const nextWallet = sdk ?? (await init());
      if (walletEligible?.googleToken) {
        await nextWallet.default.GooglePay.tokenize(walletEligible.googleToken, cardDetails?.displayName ?? "");
        await syncWalletEligibility(cardDetails?.lastFour, address);
        return true;
      }
      const { cardId, cardSecret } = await queryClient.fetchQuery<{
        cardId: string;
        cardSecret: string;
      }>({ queryKey: ["card", "provisioning"] });
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by MeaWallet legacy push provisioning
      await nextWallet.default.GooglePay.pushCard(
        nextWallet.MppCardDataParameters.withCardSecret(cardId, cardSecret),
        cardDetails?.displayName ?? "",
        {},
      );
      await syncWalletEligibility(cardDetails?.lastFour, address);
      return true;
    });

  return {
    AddPassButton: Platform.OS === "ios" ? sdk?.default.ApplePay.AddPassButton : undefined,
    addToAppleWallet,
    addToGoogleWallet,
    isPendingWallet,
    provisioning,
    syncWalletEligibility,
    walletEligible,
  };
}

function reportWalletError(
  error: unknown,
  provider: WalletProvider,
  operation: WalletOperation,
  context?: WalletDiagnosticContext,
) {
  withScope((scope) => {
    scope.setTag("wallet_platform", Platform.OS);
    scope.setTag("wallet_provider", provider);
    scope.setTag("wallet_operation", operation);
    scope.setContext("wallet_provisioning", { operation, platform: Platform.OS, provider, ...context });
    reportError(error);
  });
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
  const data = { operation, provider, stage, state, ...context };
  addBreadcrumb({ category: "wallet.diagnostic", data, message: `${stage} ${state}` });
  withScope((scope) => {
    scope.setTag("wallet_diagnostic", "true");
    scope.setTag("wallet_platform", Platform.OS);
    scope.setTag("wallet_stage", stage);
    scope.setTag("wallet_state", state);
    if (provider) scope.setTag("wallet_provider", provider);
    if (operation) scope.setTag("wallet_operation", operation);
    scope.setContext("wallet_diagnostic", { platform: Platform.OS, ...data });
    captureMessage(`wallet provisioning diagnostic: ${stage} ${state}`, level);
  });
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
  return startSpan(
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
        const result = await work();
        const outcome =
          result === false ? (operation === "wallet_availability" ? "unavailable" : "not_added") : "succeeded";
        span.setAttribute("wallet.outcome", outcome);
        span.setStatus({ code: 1, message: outcome });
        return result;
      } catch (error) {
        const cancelled = classifyError(error).walletCancelled;
        span.setAttribute("wallet.outcome", cancelled ? "cancelled" : "failed");
        span.setStatus({ code: cancelled ? 1 : 2, message: cancelled ? "cancelled" : "failed" });
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
  );
}

function reportWalletStatus(reason: WalletEligibilityReason, tokenStates?: string[]) {
  withScope((scope) => {
    scope.setTag("wallet_platform", Platform.OS);
    scope.setTag("wallet_provider", "google");
    scope.setTag("wallet_operation", "eligibility");
    scope.setTag("wallet_eligibility_reason", reason);
    scope.setContext("wallet_provisioning", {
      operation: "eligibility",
      platform: Platform.OS,
      provider: "google",
      reason,
      ...(tokenStates ? { tokenStates } : {}),
    });
    captureMessage("google wallet eligibility", reason === "added" || reason === "cta" ? "info" : "warning");
  });
}

function syncWalletEligibility(lastFour: string | undefined, address: string | undefined) {
  if (Platform.OS === "web" || lastFour?.length !== 4) return Promise.resolve();
  if (Platform.OS === "ios") {
    const authExpires = queryClient.getQueryData<number>(["auth"]);
    if (authExpires === undefined || authExpires <= Date.now()) return Promise.resolve();
  }
  return queryClient.refetchQueries({ exact: true, queryKey: ["wallet", "eligible", address, lastFour] });
}
