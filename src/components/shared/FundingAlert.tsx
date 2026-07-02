import React from "react";
import { useTranslation } from "react-i18next";

import { useRouter } from "expo-router";

import { useToastController } from "@tamagui/toast";

import { useMutation, useQuery } from "@tanstack/react-query";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import chain from "@exactly/common/generated/chain";

import InfoAlert from "./InfoAlert";
import { getAllowTokens } from "../../utils/lifi";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePortfolio from "../../utils/usePortfolio";
import { defaultSwap } from "../swaps/Swaps";

import type { KYCStatus } from "../../utils/server";
import type { Swap } from "../swaps/Swaps";

export default function FundingAlert() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToastController();
  const { address: account } = useAccount();
  const { data: bytecode } = useBytecode({ address: account, chainId: chain.id, query: { enabled: !!account } });
  const { data: kycStatus, isFetched: isKYCFetched } = useQuery<KYCStatus>({ queryKey: ["kyc", "status"] });
  const { portfolio, externalAssets, crossChainAssets, markets, isPending, isBalancesPending } = usePortfolio();
  const isExternal = (address: string) => !markets?.some((m) => m.asset.toLowerCase() === address.toLowerCase());
  const swappable = externalAssets.filter(
    ({ address }) => address.toLowerCase() !== zeroAddress && isExternal(address),
  );
  const { mutate: swap, isPending: isSwapPending } = useMutation({
    mutationKey: ["swap", "preset"],
    mutationFn: async () => {
      const [largest] = swappable.sort((a, b) => b.usdValue - a.usdValue);
      if (!largest) throw new Error("no swappable asset");
      const tokens = await queryClient.fetchQuery({ queryKey: ["allowTokens"], queryFn: getAllowTokens });
      const usdc = tokens.find(({ symbol }) => symbol === "USDC");
      if (!usdc) throw new Error("no usdc");
      queryClient.setQueryData<Swap>(["swap"], {
        ...defaultSwap,
        fromToken: { token: largest, external: isExternal(largest.address) },
        toToken: { token: usdc, external: isExternal(usdc.address) },
      });
    },
    onError: (error) => {
      reportError(error);
      toast.show(t("An error occurred. Please try again later."), {
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
    },
    onSuccess: () => {
      router.push("/swaps");
    },
  });
  const isKYCApproved = Boolean(
    kycStatus && "code" in kycStatus && (kycStatus.code === "ok" || kycStatus.code === "legacy kyc"),
  );
  if (!bytecode || !isKYCFetched || !isKYCApproved || isPending || isBalancesPending || portfolio.balanceUSD > 0n) {
    return null;
  }
  if (swappable.length > 0) {
    return (
      <InfoAlert
        title={t("Your assets can't back your card yet. Swap them to a supported asset to start spending.")}
        actionText={t("Swap assets")}
        loading={isSwapPending}
        onPress={() => {
          swap();
        }}
      />
    );
  }
  return (
    <InfoAlert
      title={t("Add funds to your account to start spending with the Exa Card.")}
      actionText={t("Add funds")}
      onPress={() => {
        const [bridgeable] = [...crossChainAssets].sort((a, b) => b.usdValue - a.usdValue);
        if (bridgeable) {
          router.push({
            pathname: "/(main)/add-funds/bridge",
            params: { sender: "exa", sourceChain: String(bridgeable.chainId), sourceToken: bridgeable.address },
          });
          return;
        }
        router.push("/add-funds");
      }}
    />
  );
}
