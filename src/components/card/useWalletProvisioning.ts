import { useState } from "react";
import { Platform } from "react-native";

import MeaPushProvisioning, { MppCardDataParameters } from "@meawallet/react-native-mpp";
import { useQuery } from "@tanstack/react-query";

import reportError from "../../utils/reportError";
import { fetchWalletCredentials } from "../../utils/server";

let initPromise: null | Promise<void> = null;

function initSdk() {
  initPromise ??= MeaPushProvisioning.initialize().catch((error: unknown) => {
    initPromise = null;
    throw error;
  });
  return initPromise;
}

export default function useWalletProvisioning(lastFour: string, displayName: string) {
  const [provisioning, setProvisioning] = useState(false);

  const { data: eligible, isPending } = useQuery({
    queryKey: ["wallet", "eligible", lastFour],
    queryFn: async () => {
      await initSdk();
      if (Platform.OS === "ios") {
        const [available, canAdd] = await Promise.all([
          MeaPushProvisioning.ApplePay.canAddPaymentPass(),
          MeaPushProvisioning.ApplePay.canAddPaymentPassWithPrimaryAccountNumberSuffix(lastFour),
        ]);
        return { apple: available && canAdd, google: false };
      }
      if (Platform.OS === "android") {
        return { apple: false, google: await MeaPushProvisioning.GooglePay.isWalletAvailable() };
      }
      return { apple: false, google: false };
    },
    enabled: lastFour.length === 4,
  });

  async function provision(function_: (cardData: MppCardDataParameters) => Promise<unknown>) {
    setProvisioning(true);
    try {
      await initSdk();
      const { cardId, cardSecret } = await fetchWalletCredentials();
      await function_(MppCardDataParameters.withCardSecret(cardId, cardSecret));
    } catch (error) {
      reportError(error);
    } finally {
      setProvisioning(false);
    }
  }

  return {
    eligible,
    provisioning,
    isPending,
    addToAppleWallet: () =>
      provision(async (cardData) => {
        const response = await MeaPushProvisioning.ApplePay.initializeOemTokenization(cardData);
        await MeaPushProvisioning.ApplePay.showAddPaymentPassView(response);
      }),
    addToGoogleWallet: () => provision((cardData) => MeaPushProvisioning.GooglePay.pushCard(cardData, displayName, {})),
  };
}
