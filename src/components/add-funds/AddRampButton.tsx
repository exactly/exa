import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import chain from "@exactly/common/generated/chain";

import AddFundsOption from "./AddFundsOption";
import { bridgeMethods, currencies } from "../../utils/currencies";
import networkLogos from "../../utils/networkLogos";
import AssetLogo from "../shared/AssetLogo";
import Image from "../shared/Image";
import Text from "../shared/Text";
import View from "../shared/View";

export default function AddRampButton({
  currency,
  network,
  provider,
  status,
}: {
  currency: string;
  network?: string;
  provider: "bridge" | "manteca";
  status: "ACTIVE" | "NOT_AVAILABLE" | "NOT_STARTED" | "ONBOARDING";
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const isCrypto = !!network;

  if (status === "NOT_AVAILABLE") return null;

  function handlePress() {
    const params = { currency, provider, ...(network && { network }) };
    switch (status) {
      case "NOT_STARTED":
        router.push({ pathname: "/add-funds/onboard", params });
        break;
      case "ONBOARDING":
        router.push({ pathname: "/add-funds/status", params: { ...params, status: "ONBOARDING" } });
        break;
      case "ACTIVE":
        router.push({ pathname: isCrypto ? "/add-funds/add-crypto" : "/add-funds/ramp", params });
        break;
    }
  }

  if (isCrypto) {
    return (
      <AddFundsOption
        icon={
          <View position="relative" width={24} height={24}>
            <AssetLogo symbol={currency} width={24} height={24} />
            {network && network in networkLogos && (
              <View
                position="absolute"
                bottom={-4}
                right={-4}
                borderRadius="$r_0"
                borderWidth={1}
                borderColor="white"
                overflow="hidden"
              >
                <Image source={{ uri: networkLogos[network] }} width={14} height={14} borderRadius="$r_0" />
              </View>
            )}
          </View>
        }
        title={t("{{currency}} from {{network}}", { currency, network })}
        subtitle={t("Receive USDC on {{chain}}", { chain: chain.name })}
        onPress={handlePress}
      />
    );
  }

  const info = currency in currencies ? currencies[currency as keyof typeof currencies] : undefined;
  const emoji = info?.emoji ?? "💰";
  const shortName = t(info?.shortName ?? currency);
  const method = currency in bridgeMethods ? bridgeMethods[currency as keyof typeof bridgeMethods] : undefined;
  const title =
    provider === "bridge" && method
      ? t("{{currency}} via {{method}}", { currency: shortName, method })
      : provider === "manteca" && currency === "USD"
        ? t("{{currency}} from Argentina", { currency: shortName })
        : shortName;

  return (
    <AddFundsOption icon={<Text>{emoji}</Text>} title={title} subtitle={t("Receive USDC")} onPress={handlePress} />
  );
}
