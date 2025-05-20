import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import { RefreshControl } from "react-native";
import { ScrollView, useTheme } from "tamagui";
import { zeroAddress } from "viem";

import PaySelector from "./PaySelector";
import PaymentSheet from "./PaymentSheet";
import UpcomingPayments from "./UpcomingPayments";
import { useReadPreviewerExactly } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function PayMode() {
  const theme = useTheme();
  const parameters = useLocalSearchParams();
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
              <UpcomingPayments
                onSelect={(maturity) => {
                  router.setParams({ ...parameters, maturity: maturity.toString() });
                  setPaySheetOpen(true);
                }}
              />
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                *The Exa Card is issued by Third National pursuant to a license from Visa. Any credit issued by Exactly
                Protocol subject to its separate terms and conditions. Third National is not a party to any agreement
                with Exactly Protocol and is not responsible for any loan or credit arrangement between user and Exactly
                Protocol.
              </Text>
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
