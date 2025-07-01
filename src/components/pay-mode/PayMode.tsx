import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { router, useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import React, { useState } from "react";
import { RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack } from "tamagui";
import { zeroAddress } from "viem";

import OverduePayments from "./OverduePayments";
import PaySelector from "./PaySelector";
import PaymentSheet from "./PaymentSheet";
import UpcomingPayments from "./UpcomingPayments";
import { useReadPreviewerExactly } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PayMode() {
  const theme = useTheme();
  const parameters = useLocalSearchParams();
  const { presentCollection } = useIntercom();
  const [paySheetOpen, setPaySheetOpen] = useState(false);
  const { account } = useAsset(marketUSDCAddress);
  const { refetch, isPending } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundMild">
        <ScrollView
          ref={payModeScrollReference}
          showsVerticalScrollIndicator={false}
          flex={1}
          refreshControl={
            <RefreshControl
              ref={payModeRefreshControlReference}
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
            <PaySelector />
            <View padded gap="$s6">
              <OverduePayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: maturity.toString() });
                  setPaySheetOpen(true);
                }}
              />
              <UpcomingPayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: maturity.toString() });
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
                      openBrowserAsync(`https://exact.ly/`).catch(reportError);
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
                  . The Exa App does not issue or guarantee any loans.
                </Text>
              </XStack>
            </View>
            <PaymentSheet
              open={paySheetOpen}
              onClose={() => {
                setPaySheetOpen(false);
                router.replace({ pathname: "/pay-mode", params: { ...parameters, maturity: null } });
              }}
            />
          </>
        </ScrollView>
      </View>
    </SafeView>
  );
}

export const payModeScrollReference = React.createRef<ScrollView>();
export const payModeRefreshControlReference = React.createRef<RefreshControl>();
