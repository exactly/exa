import React, { useState, type RefObject } from "react";
import { Trans } from "react-i18next";
import { RefreshControl } from "react-native";

import { useLocalSearchParams, useRouter } from "expo-router";

import { ScrollView, XStack } from "tamagui";

import { zeroAddress } from "viem";

import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { useReadPreviewerExactly } from "@exactly/common/generated/hooks";

import OverduePayments from "./OverduePayments";
import PaymentSheet from "./PaymentSheet";
import PaySelector from "./PaySelector";
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
                  <Trans
                    i18nKey="Onchain credit is powered by <protocol>Exactly Protocol</protocol> and is subject to separate <terms>Terms and conditions</terms>. The Exa App does not issue or guarantee any funding."
                    components={{
                      protocol: (
                        <Text
                          cursor="pointer"
                          caption2
                          color="$interactiveOnDisabled"
                          textDecorationLine="underline"
                          onPress={() => {
                            openBrowser("https://exact.ly/").catch(reportError);
                          }}
                        />
                      ),
                      terms: (
                        <Text
                          cursor="pointer"
                          caption2
                          color="$interactiveOnDisabled"
                          textDecorationLine="underline"
                          onPress={() => {
                            presentCollection("10544608").catch(reportError);
                          }}
                        />
                      ),
                    }}
                  />
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

export const payModeScrollReference: RefObject<null | ScrollView> = { current: null };
export const payModeRefreshControlReference: RefObject<null | RefreshControl> = { current: null };
