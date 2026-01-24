import React, { useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { zeroAddress } from "viem";
import { useChainId } from "wagmi";

import { marketUsdcAddress, useReadPreviewerExactly } from "@exactly/common/generated/hooks";

import CreditLine from "./CreditLine";
import { presentArticle } from "../../utils/intercom";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import PaymentSheet from "../pay-mode/PaymentSheet";
import UpcomingPayments from "../pay-mode/UpcomingPayments";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Loans() {
  const { t } = useTranslation();
  const parameters = useLocalSearchParams();
  const chainId = useChainId();
  const { account } = useAsset(marketUsdcAddress[chainId as keyof typeof marketUsdcAddress]);
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const router = useRouter();
  const { refetch, isPending } = useReadPreviewerExactly({ args: [account ?? zeroAddress] });
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <ScrollView
          ref={loansScrollReference}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={
            <RefreshControl
              ref={loansRefreshControlReference}
              refreshing={isPending}
              onRefresh={() => {
                refetch().catch(reportError);
                queryClient.refetchQueries({ queryKey: ["activity"] }).catch(reportError);
              }}
            />
          }
        >
          <>
            <View backgroundColor="$backgroundSoft" padded>
              <YStack paddingBottom="$s3" gap="$s4_5">
                <XStack alignItems="center" justifyContent="space-between">
                  <Pressable
                    onPress={() => {
                      if (router.canGoBack()) {
                        router.back();
                      } else {
                        router.replace("/defi");
                      }
                    }}
                  >
                    <ArrowLeft size={24} color="$uiNeutralPrimary" />
                  </Pressable>
                  <Text emphasized subHeadline textAlign="center">
                    {t("Exactly Protocol")}
                  </Text>
                  <Pressable
                    onPress={() => {
                      presentArticle("11541409").catch(reportError);
                    }}
                  >
                    <CircleHelp color="$uiNeutralSecondary" />
                  </Pressable>
                </XStack>
                <Text subHeadline secondary>
                  {t(
                    "Get fixed-interest funding using your assets as collateral, no credit check needed. Choose an amount and repayment plan to receive USDC.",
                  )}
                </Text>
              </YStack>
            </View>
            <View gap="$s6" padded>
              <CreditLine />
              <UpcomingPayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: String(maturity) });
                  setPaySheetOpen(true);
                }}
              />
            </View>
            <XStack gap="$s4" alignItems="flex-start" padding="$s4" flexWrap="wrap">
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                {t(
                  "You are accessing a decentralized protocol using your crypto as collateral. The Exa App does not issue funding or provide credit. No credit checks or intermediaries are involved.",
                )}
              </Text>
            </XStack>
            <PaymentSheet
              open={paySheetOpen}
              onClose={() => {
                setPaySheetOpen(false);
                router.setParams({ ...parameters, maturity: undefined });
              }}
            />
          </>
        </ScrollView>
      </View>
    </SafeView>
  );
}

export const loansScrollReference: RefObject<null | ScrollView> = { current: null };
export const loansRefreshControlReference: RefObject<null | RefreshControl> = { current: null };
