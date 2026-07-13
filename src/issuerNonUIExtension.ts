// cspell:ignore Felica

import { AppRegistry, Image } from "react-native";

import MeaPushProvisioning, { IssuerExtensionHandler, MppCardDataParameters } from "@meawallet/react-native-mpp";
import { object, parse, string } from "valibot";

import domain from "@exactly/common/domain";

import cardSignatureArt from "./generated/card-signature.png";
import { getSnapshot, getToken } from "./utils/walletExtensionStorage";

const PASS_ENTRIES_TIMEOUT = 15_000;

class ExaIssuerExtensionHandler extends IssuerExtensionHandler {
  async status() {
    try {
      const context = await getContext();
      return {
        passEntriesAvailable: Boolean(context),
        remotePassEntriesAvailable: false,
        requiresAuthentication: false,
      };
    } catch {
      return {
        passEntriesAvailable: false,
        remotePassEntriesAvailable: false,
        requiresAuthentication: false,
      };
    }
  }

  async passEntries() {
    try {
      const context = await getContext();
      if (!context) return [];
      await MeaPushProvisioning.initialize();
      const abort = new AbortController();
      const deadline = Date.now() + PASS_ENTRIES_TIMEOUT;
      const timeout = setTimeout(() => abort.abort(), PASS_ENTRIES_TIMEOUT);
      let response: Response;
      try {
        response = await fetch(
          `${domain === "localhost" ? "http://localhost:3000" : `https://${domain}`}/api/card/provisioning`,
          { headers: { authorization: `Bearer ${context.token.token}` }, signal: abort.signal },
        );
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) throw new Error("bad card provisioning response");
      const provisioning = parse(object({ id: string(), secret: string() }), await response.json());
      const tokenization = await withTimeout(
        MeaPushProvisioning.ApplePay.initializeOemTokenization(
          MppCardDataParameters.withCardSecret(provisioning.id, provisioning.secret),
        ),
        Math.max(0, deadline - Date.now()),
      );
      const { primaryAccountIdentifier } = tokenization;
      if (primaryAccountIdentifier) {
        const passExists =
          await MeaPushProvisioning.ApplePay.secureElementPassExistsWithPrimaryAccountIdentifier(
            primaryAccountIdentifier,
          );
        if (passExists) {
          return [];
        }
        const canAddPass =
          (await MeaPushProvisioning.ApplePay.canAddPaymentPassWithPrimaryAccountIdentifier(
            primaryAccountIdentifier,
          ).catch(() => false)) ||
          (await MeaPushProvisioning.ApplePay.canAddSecureElementPassWithPrimaryAccountIdentifier(
            primaryAccountIdentifier,
          ).catch(() => false));
        if (!canAddPass) {
          return [];
        }
      }
      return [
        {
          identifier: tokenization.tokenizationReceipt,
          art: Image.resolveAssetSource(cardSignatureArt),
          title: "Exa Card",
          addRequestConfiguration: {
            style: "payment",
            cardholderName: tokenization.cardholderName || context.snapshot.displayName,
            primaryAccountSuffix: tokenization.primaryAccountSuffix || context.snapshot.lastFour,
            cardDetails: [
              ["Card", `Visa ending in ${context.snapshot.lastFour}`],
              ["Expires", `${context.snapshot.expirationMonth}/${context.snapshot.expirationYear.slice(-2)}`],
            ] satisfies [string, string][],
            ...(primaryAccountIdentifier ? { primaryAccountIdentifier } : {}),
            paymentNetwork: "visa",
            productIdentifiers: context.snapshot.productId ? [context.snapshot.productId] : [],
            requiresFelicaSecureElement: false,
          } satisfies { [key: string]: unknown; style: "access" | "payment" },
        },
      ];
    } catch {
      return [];
    }
  }

  remotePassEntries() {
    return Promise.resolve([]);
  }
}

function withTimeout<T>(promise: Promise<T>, timeout: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("operation timed out")), timeout);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

const issuerExtensionHandler = new ExaIssuerExtensionHandler();

AppRegistry.registerComponent("IssuerNonUIExtension", () => IssuerNonUIExtension);

function IssuerNonUIExtension() {
  return issuerExtensionHandler.render();
}

async function getContext() {
  const [token, snapshot] = await Promise.all([getToken(), getSnapshot()]);
  if (
    !token ||
    !Number.isFinite(token.expire) ||
    token.expire <= Date.now() ||
    typeof snapshot?.lastFour !== "string" ||
    !/^\d{4}$/.test(snapshot.lastFour)
  )
    return null;
  return { snapshot, token };
}
