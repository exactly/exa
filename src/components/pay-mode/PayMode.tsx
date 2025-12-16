import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";
import { useRouter, useLocalSearchParams } from "expo-router";
import React, { useState, type RefObject } from "react";
import { RefreshControl } from "react-native";
import { ScrollView, XStack } from "tamagui";
import { zeroAddress } from "viem";

import OverduePayments from "./OverduePayments";
import PaySelector from "./PaySelector";
import PaymentSheet from "./PaymentSheet";
import UpcomingPayments from "./UpcomingPayments";
import { presentCollection } from "../../utils/intercom";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PayMode() {
  const parameters = useLocalSearchParams();
  const { account } = useAsset(marketUSDCAddress);
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const router = useRouter();
  const { refetch, isPending } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <View position="absolute" top={0} left={0} right={0} height="50%" backgroundColor="$backgroundSoft" />
        <ScrollView
          ref={payModeScrollReference}
          backgroundColor="transparent"
          contentContainerStyle={{ backgroundColor: "$backgroundMild" }}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={
            <RefreshControl
              ref={payModeRefreshControlReference}
              refreshing={isPending}
              onRefresh={() => {
                refetch().catch(reportError);
                queryClient.refetchQueries({ queryKey: ["activity"] }).catch(reportError);
              }}
            />
          }
        >
          <>
            <PaySelector />
            <View padded gap="$s6">
              <OverduePayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: String(maturity) });
                  setPaySheetOpen(true);
                }}
              />
              <UpcomingPayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: String(maturity) });
                  setPaySheetOpen(true);
                }}
              />
              <XStack gap="$s4" alignItems="flex-start" paddingTop="$s3" flexWrap="wrap">
                <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                  Onchain credit is powered by&nbsp;
                  <Text
                    cursor="pointer"
                    caption2
                    color="$interactiveOnDisabled"
                    textDecorationLine="underline"
                    onPress={() => {
                      openBrowser(`https://exact.ly/`).catch(reportError);
                    }}
                  >
                    Exactly Protocol
                  </Text>
                  &nbsp;and is subject to separate&nbsp;
                  <Text
                    cursor="pointer"
                    caption2
                    color="$interactiveOnDisabled"
                    textDecorationLine="underline"
                    onPress={() => {
                      presentCollection("10544608").catch(reportError);
                    }}
                  >
                    Terms and conditions
                  </Text>
                  . The Exa App does not issue or guarantee any funding.
                </Text>
              </XStack>
            </View>
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

export const payModeScrollReference: RefObject<ScrollView | null> = { current: null };
export const payModeRefreshControlReference: RefObject<RefreshControl | null> = { current: null };
