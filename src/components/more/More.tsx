import { exaPreviewerAddress, marketUSDCAddress, previewerAddress } from "@exactly/common/generated/chain";
import { Boxes, Coins, CreditCard, HandCoins, Home, ReceiptText, Repeat } from "@tamagui/lucide-icons";
import { router } from "expo-router";
import React from "react";
import { RefreshControl } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import { useReadExaPreviewerPendingProposals, useReadPreviewerExactly } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAsset from "../../utils/useAsset";
import ProfileHeader from "../shared/ProfileHeader";
import SafeView from "../shared/SafeView";
import StatusIndicator from "../shared/StatusIndicator";
import Text from "../shared/Text";
import View from "../shared/View";

export default function More() {
  const theme = useTheme();
  const { account } = useAsset(marketUSDCAddress);
  const { refetch, isPending } = useReadPreviewerExactly({ address: previewerAddress, args: [account ?? zeroAddress] });
  const { data: bytecode } = useBytecode({ address: account ?? zeroAddress, query: { enabled: !!account } });
  const { data: pendingProposals } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [account ?? zeroAddress],
    query: { enabled: !!account && !!bytecode, gcTime: 0, refetchInterval: 30_000 },
  });
  const style = { backgroundColor: theme.backgroundSoft.val, margin: -5 };
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <ScrollView
        ref={moreScrollReference}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            ref={moreRefreshControlReference}
            style={style}
            refreshing={isPending}
            onRefresh={() => {
              refetch().catch(reportError);
              queryClient.refetchQueries({ queryKey: ["activity"] }).catch(reportError);
            }}
          />
        }
        flex={1}
      >
        <YStack gap="$s5">
          <ProfileHeader />
          <View padded gap="$s4_5">
            {screens.map(({ name: path, title, Icon }, index) => {
              const disabled = path === "defi" && !bytecode;
              if (path === "swaps") return null;
              if (path === "loans") return null;
              return (
                <XStack
                  key={index}
                  gap="$s3_5"
                  alignItems="center"
                  cursor={disabled ? "not-allowed" : "pointer"}
                  onPress={() => {
                    if (disabled) return;
                    router.replace(path === "index" ? "/(app)/(home)" : `/(app)/(home)/${path}`);
                  }}
                >
                  <View>
                    {path === "activity" && pendingProposals && pendingProposals.length > 0 && (
                      <StatusIndicator type="notification" />
                    )}
                    <Icon color={disabled ? "$interactiveTextDisabled" : "$uiBrandSecondary"} />
                  </View>
                  <Text primary subHeadline color={disabled ? "$interactiveTextDisabled" : "$backgroundBrand"}>
                    {title}
                  </Text>
                </XStack>
              );
            })}
          </View>
        </YStack>
      </ScrollView>
    </SafeView>
  );
}

const screens = [
  { name: "index", title: "Home", Icon: Home },
  { name: "card", title: "Card", Icon: CreditCard },
  { name: "pay-mode", title: "Pay Mode", Icon: Coins },
  { name: "defi", title: "DeFi", Icon: Boxes },
  { name: "loans", title: "Loans", Icon: HandCoins },
  { name: "swaps", title: "Swaps", Icon: Repeat },
  { name: "activity", title: "Activity", Icon: ReceiptText },
] as const;

export const moreScrollReference = React.createRef<ScrollView>();
export const moreRefreshControlReference = React.createRef<RefreshControl>();
