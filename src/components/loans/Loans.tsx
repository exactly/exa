import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { CircleHelp } from "@tamagui/lucide-icons";
import { router, useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import React, { useState } from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import CreditLine from "./CreditLine";
import { useReadPreviewerExactly } from "../../generated/contracts";
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
                <XStack gap={10} justifyContent="space-between" alignItems="center">
                  <Text fontSize={20} fontWeight="bold">
                    Exa Loans
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
                  Use assets from your Portfolio as collateral to access fixed-rate USDC onchain loans, powered by
                  Exactly Protocol.
                </Text>
              </YStack>
            </View>
            <View gap="$s6" padded>
              <CreditLine />
              <UpcomingPayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: maturity.toString() });
                  setPaySheetOpen(true);
                }}
              />
            </View>
            <XStack gap="$s4" alignItems="flex-start" padding="$s4" flexWrap="wrap">
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                Loan services are decentralized and powered by&nbsp;
                <Text
                  cursor="pointer"
                  caption2
                  color="$interactiveOnDisabled"
                  textDecorationLine="underline"
                  onPress={() => {
                    openBrowserAsync(`https://exact.ly/`).catch(reportError);
                  }}
                >
                  Exactly Protocol
                </Text>
                . The Exa App does not underwrite or originate any credit products.
              </Text>
            </XStack>
            <PaymentSheet
              open={paySheetOpen}
              onClose={() => {
                setPaySheetOpen(false);
                router.replace({ pathname: "/loans", params: { ...parameters, maturity: null } });
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
