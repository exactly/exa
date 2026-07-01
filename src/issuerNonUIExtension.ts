// cspell:ignore Felica

import "./utils/polyfill";

import { useRef } from "react";
import { AppRegistry, Image } from "react-native";

import MeaPushProvisioning, { IssuerExtensionHandler, MppCardDataParameters } from "@meawallet/react-native-mpp";
import { object, parse, string } from "valibot";

import domain from "@exactly/common/domain";

import cardSignatureArt from "./assets/images/card-signature.png";
import { getCardProvisioningSnapshot, getWalletExtensionToken } from "./utils/walletExtensionStorage";

class ExaIssuerExtensionHandler extends IssuerExtensionHandler {
  async status() {
    return {
      passEntriesAvailable: Boolean(await getContext().catch(() => null)),
      remotePassEntriesAvailable: false,
      requiresAuthentication: false,
    };
  }

  async passEntries() {
    try {
      const context = await getContext();
      if (!context) return [];
      await MeaPushProvisioning.initialize();
      const response = await fetch(
        `${domain === "localhost" ? "http://localhost:3000" : `https://${domain}`}/api/card/provisioning`,
        { headers: { authorization: `Bearer ${context.token.token}` } },
      );
      if (!response.ok) throw new Error("bad card provisioning response");
      const provisioning = parse(object({ id: string(), secret: string() }), await response.json());
      const tokenization = await MeaPushProvisioning.ApplePay.initializeOemTokenization(
        MppCardDataParameters.withCardSecret(provisioning.id, provisioning.secret),
      );
      const { primaryAccountIdentifier } = tokenization;
      if (primaryAccountIdentifier) {
        const passExists =
          await MeaPushProvisioning.ApplePay.secureElementPassExistsWithPrimaryAccountIdentifier(
            primaryAccountIdentifier,
          );
        if (passExists) return [];
        const canAddPass =
          (await MeaPushProvisioning.ApplePay.canAddPaymentPassWithPrimaryAccountIdentifier(
            primaryAccountIdentifier,
          ).catch(() => false)) ||
          (await MeaPushProvisioning.ApplePay.canAddSecureElementPassWithPrimaryAccountIdentifier(
            primaryAccountIdentifier,
          ).catch(() => false));
        if (!canAddPass) return [];
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

function IssuerNonUIExtension() {
  const handlerRef = useRef<ExaIssuerExtensionHandler>(null);
  handlerRef.current ??= new ExaIssuerExtensionHandler();
  return null;
}

AppRegistry.registerComponent("IssuerNonUIExtension", () => IssuerNonUIExtension);

async function getContext() {
  const [token, snapshot] = await Promise.all([getWalletExtensionToken(), getCardProvisioningSnapshot()]);
  if (!token || !Number.isFinite(token.expire) || token.expire <= Date.now() || snapshot?.lastFour.length !== 4)
    return null;
  return { snapshot, token };
}
