import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import type { Passkey } from "@exactly/common/validation";
import { CircleHelp, Eye, EyeOff } from "@tamagui/lucide-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import React, { useState } from "react";
import { Pressable, RefreshControl } from "react-native";
import { ms } from "react-native-size-matters";
import { ScrollView, useTheme, XStack } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import CardDetails from "./CardDetails";
import SimulatePurchase from "./SimulatePurchase";
import SpendingLimits from "./SpendingLimits";
import ExaCard from "./exa-card/ExaCard";
import {
  useReadPreviewerExactly,
  useReadUpgradeableModularAccountGetInstalledPlugins,
} from "../../generated/contracts";
import handleError from "../../utils/handleError";
import { createInquiry, resumeInquiry } from "../../utils/persona";
import queryClient from "../../utils/queryClient";
import { APIError, getActivity, getCard, createCard, getKYCStatus } from "../../utils/server";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import InfoAlert from "../shared/InfoAlert";
import LatestActivity from "../shared/LatestActivity";
import PluginUpgrade from "../shared/PluginUpgrade";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Card() {
  const theme = useTheme();
  const { presentArticle } = useIntercom();
  const [cardDetailsOpen, setCardDetailsOpen] = useState(false);
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  function toggle() {
    queryClient.setQueryData(["settings", "sensitive"], !hidden);
  }
  const { data: passkey } = useQuery<Passkey>({ queryKey: ["passkey"] });
  const {
    data: purchases,
    refetch: refetchPurchases,
    isPending,
  } = useQuery({
    queryKey: ["activity", "card"],
    queryFn: () => getActivity({ include: "card" }),
  });

  const { queryKey } = useAsset(marketUSDCAddress);
  const { address } = useAccount();
  const { data: KYCStatus, refetch: refetchKYCStatus } = useQuery({
    queryKey: ["kyc", "status"],
    queryFn: getKYCStatus,
  });
  const { refetch: refetchInstalledPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address: address ?? zeroAddress,
  });

  const { data: markets, refetch: refetchMarkets } = useReadPreviewerExactly({
    address: previewerAddress,
    args: [address ?? zeroAddress],
  });

  let usdBalance = 0n;
  if (markets) {
    for (const market of markets) {
      if (market.floatingDepositAssets > 0n) {
        usdBalance += (market.floatingDepositAssets * market.usdPrice) / 10n ** BigInt(market.decimals);
      }
    }
  }

  const { data: cardDetails, refetch: refetchCard } = useQuery({
    queryKey: ["card", "details"],
    queryFn: getCard,
    retry: false,
    gcTime: 0,
    staleTime: 0,
  });

  const {
    mutateAsync: revealCard,
    isPending: isRevealing,
    error: revealError,
  } = useMutation({
    mutationKey: ["card", "reveal"],
    mutationFn: async function handleReveal() {
      if (usdBalance === 0n) {
        router.push("/getting-started");
        return;
      }
      if (isRevealing) return;
      if (!passkey) return;
      try {
        const { isSuccess } = await refetchCard();
        if (isSuccess) {
          setCardDetailsOpen(true);
          return;
        }
        const result = await getKYCStatus();
        if (result === "ok") {
          await createCard();
          const { data: card } = await refetchCard();
          if (card) setCardDetailsOpen(true);
          return;
        }
        if (typeof result !== "string") {
          resumeInquiry(result.inquiryId, result.sessionToken).catch(handleError);
        }
      } catch (error) {
        if (!(error instanceof APIError)) {
          handleError(error);
          return;
        }
        const { code, text } = error;
        if (
          (code === 403 && text === "kyc required") ||
          (code === 404 && text === "kyc not found") ||
          (code === 400 && text === "kyc not started")
        ) {
          createInquiry(passkey).catch(handleError);
        }
        handleError(error);
      }
    },
  });
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <ScrollView
          backgroundColor="$backgroundMild"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              style={style}
              refreshing={isPending}
              onRefresh={() => {
                refetchCard().catch(handleError);
                refetchPurchases().catch(handleError);
                refetchMarkets().catch(handleError);
                refetchKYCStatus().catch(handleError);
                refetchInstalledPlugins().catch(handleError);
                queryClient.refetchQueries({ queryKey }).catch(handleError);
              }}
            />
          }
        >
          <View fullScreen>
            <View flex={1}>
              <View alignItems="center" gap="$s5" width="100%" backgroundColor="$backgroundSoft" padded>
                <XStack gap={ms(10)} justifyContent="space-between" alignItems="center" width="100%">
                  <Text fontSize={ms(20)} fontWeight="bold">
                    My Exa Card
                  </Text>
                  <View display="flex" flexDirection="row" alignItems="center" gap={16}>
                    <Pressable onPress={toggle} hitSlop={ms(15)}>
                      {hidden ? (
                        <EyeOff size={24} color="$uiNeutralPrimary" />
                      ) : (
                        <Eye size={24} color="$uiNeutralPrimary" />
                      )}
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        presentArticle("9994746").catch(handleError);
                      }}
                      hitSlop={ms(15)}
                    >
                      <CircleHelp size={24} color="$uiNeutralPrimary" />
                    </Pressable>
                  </View>
                </XStack>
                {(usdBalance === 0n || KYCStatus !== "ok") && (
                  <InfoAlert
                    title="Your card is awaiting activation. Follow the steps to enable it."
                    actionText="Get started"
                    onPress={() => {
                      router.push("/getting-started");
                    }}
                  />
                )}
                <PluginUpgrade />
                <ExaCard
                  revealing={isRevealing}
                  frozen={cardDetails?.status === "FROZEN"}
                  onPress={() => {
                    if (isRevealing) return;
                    revealCard().catch(handleError);
                  }}
                />
                {revealError && (
                  <Text color="$uiErrorPrimary" fontWeight="bold">
                    {revealError.message}
                  </Text>
                )}
              </View>
              <View padded gap="$s5">
                {cardDetails && cardDetails.mode > 0 && <SimulatePurchase installments={cardDetails.mode} />}
                <LatestActivity activity={purchases} title="Latest purchases" />
                <SpendingLimits />
              </View>
            </View>
          </View>
        </ScrollView>
        <CardDetails
          open={cardDetailsOpen}
          onClose={() => {
            setCardDetailsOpen(false);
          }}
        />
      </View>
    </SafeView>
  );
}
