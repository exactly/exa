import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { ArrowLeft, CircleHelp } from "@tamagui/lucide-icons";
import { useNavigation, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import CreditLine from "./CreditLine";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import PaymentSheet from "../pay-mode/PaymentSheet";
import UpcomingPayments from "../pay-mode/UpcomingPayments";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Loans() {
  const theme = useTheme();
  const { presentArticle } = useIntercom();
  const parameters = useLocalSearchParams();
  const { account } = useAsset(marketUSDCAddress);
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const navigation = useNavigation<AppNavigationProperties>();
  const { refetch, isPending } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
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
              style={style}
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
                      if (navigation.canGoBack()) {
                        navigation.goBack();
                      } else {
                        navigation.replace("(home)", { screen: "defi" });
                      }
                    }}
                  >
                    <ArrowLeft size={24} color="$uiNeutralPrimary" />
                  </Pressable>
                  <Text emphasized subHeadline textAlign="center">
                    Exactly Protocol
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
                  Get fixed-interest funding using your assets as collateral, no credit check needed. Choose an amount
                  and repayment plan to receive USDC.
                </Text>
              </YStack>
            </View>
            <View gap="$s6" padded>
              <CreditLine />
              <UpcomingPayments
                onSelect={(maturity) => {
                  navigation.setParams({ ...parameters, maturity: maturity.toString() });
                  setPaySheetOpen(true);
                }}
              />
            </View>
            <XStack gap="$s4" alignItems="flex-start" padding="$s4" flexWrap="wrap">
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                You are accessing a decentralized protocol using your crypto as collateral. The Exa App does not issue
                funding or provide credit. No credit checks or intermediaries are involved.
              </Text>
            </XStack>
            <PaymentSheet
              open={paySheetOpen}
              onClose={() => {
                setPaySheetOpen(false);
                navigation.setParams({ ...parameters, maturity: undefined });
              }}
            />
          </>
        </ScrollView>
      </View>
    </SafeView>
  );
}

export const loansScrollReference = React.createRef<ScrollView>();
export const loansRefreshControlReference = React.createRef<RefreshControl>();
