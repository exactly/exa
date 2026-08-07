import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform } from "react-native";

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

const hiddenWallet = { apple: "hidden", google: "hidden", googleToken: null } satisfies WalletEligibility;
const primaryAccountIdentifiers = new Map<string, string>();

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
  const { data: walletEligible, isPending: isPendingWallet } = useQuery<WalletEligibility>({
    queryKey: ["wallet", "eligible", address, cardDetails?.lastFour],
    enabled: Platform.OS !== "web" && cardDetails?.lastFour.length === 4,
    queryFn: async () => {
      const lastFour = cardDetails?.lastFour;
      if (!lastFour || Platform.OS === "web") return hiddenWallet;
      const nextWallet = await init();
      if (Platform.OS === "ios") {
        try {
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
          reportError(error);
          return hiddenWallet;
        }
      }
      if (Platform.OS !== "android") return hiddenWallet;
      return nextWallet.default.GooglePay.isWalletAvailable()
        .then(async (available) => {
          if (!available) return hiddenWallet;
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
              )
                return [];
              reportError(error);
            },
          );
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
          reportError(error);
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
    if (Platform.OS === "web" || cardDetails?.lastFour.length !== 4) return;
    const lastFour = cardDetails.lastFour;
    let mounted = true;
    let cleanup: (() => void) | undefined;
    init()
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
      .catch(reportError);
    return () => {
      mounted = false;
      cleanup?.();
    };
  }, [address, cardDetails?.lastFour]);

  const runWalletProvisioning = async (work: () => Promise<boolean>) => {
    if (walletInFlightRef.current) return;
    walletInFlightRef.current = true;
    setProvisioning(true);
    try {
      if (await work()) {
        Alert.alert(t("Card added"), t("Your card was added to your wallet. Follow any remaining steps if prompted."));
      }
    } catch (error) {
      const classification = classifyError(error);
      if (!classification.walletCancelled) {
        reportError(error);
        Alert.alert(t("Something went wrong. Please try again."));
      }
    } finally {
      walletInFlightRef.current = false;
      setProvisioning(false);
    }
  };

  const addToAppleWallet = () =>
    runWalletProvisioning(async () => {
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
    runWalletProvisioning(async () => {
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

function syncWalletEligibility(lastFour: string | undefined, address: string | undefined) {
  if (Platform.OS === "web" || lastFour?.length !== 4) return Promise.resolve();
  if (Platform.OS === "ios") {
    const authExpires = queryClient.getQueryData<number>(["auth"]);
    if (authExpires === undefined || authExpires <= Date.now()) return Promise.resolve();
  }
  return queryClient.refetchQueries({ exact: true, queryKey: ["wallet", "eligible", address, lastFour] });
}
