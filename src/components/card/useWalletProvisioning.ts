import { useRef, useState } from "react";
import { Platform } from "react-native";

import MeaPushProvisioning, { MppCardDataParameters } from "@meawallet/react-native-mpp";
import { useQuery } from "@tanstack/react-query";

import reportError, { isWalletCancelled } from "../../utils/reportError";
import { getWalletCredentials } from "../../utils/server";

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
  const inFlightRef = useRef(false);

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

  async function provision(addToWallet: (cardData: MppCardDataParameters) => Promise<unknown>) {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setProvisioning(true);
    try {
      await initSdk();
      const { cardId, cardSecret } = await getWalletCredentials();
      await addToWallet(MppCardDataParameters.withCardSecret(cardId, cardSecret));
    } catch (error) {
      if (!isWalletCancelled(error)) reportError(error);
    } finally {
      inFlightRef.current = false;
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
    addToGoogleWallet: () => provision((cardData) => MeaPushProvisioning.GooglePay.push(cardData, displayName, {})),
  };
}
