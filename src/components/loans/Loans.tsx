import { marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { CircleHelp } from "@tamagui/lucide-icons";
import React from "react";
import { Pressable, RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";

import CreditLine from "./CreditLine";
import { useReadPreviewerExactly } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function Loans() {
  const theme = useTheme();
  const { presentArticle } = useIntercom();
  const { account } = useAsset(marketUSDCAddress);
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
                  Use your collateral to get a fixed-interest loan, no credit check required. Simply choose an amount
                  and a repayment plan to receive USDC.
                </Text>
              </YStack>
            </View>
            <View gap="$s6" padded>
              <CreditLine />
            </View>
            <View padded>
              <Text caption2 color="$interactiveOnDisabled" textAlign="justify">
                All borrowing and spending features are enabled by non-custodial smart contracts. Terms apply.
              </Text>
            </View>
          </>
        </ScrollView>
      </View>
    </SafeView>
  );
}

export const loansScrollReference = React.createRef<ScrollView>();
export const loansRefreshControlReference = React.createRef<RefreshControl>();
