import { CircleHelp, Link } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import React, { useState } from "react";
import type { RefreshControl } from "react-native";
import { Pressable } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";

import ConnectionSheet from "./ConnectionSheet";
import DisconnectSheet from "./DisconnectSheet";
import IntroSheet from "./IntroSheet";
import ExactlyLogo from "../../assets/images/exactly.svg";
import LiFiLogo from "../../assets/images/lifi.svg";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useIntercom from "../../utils/useIntercom";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function DeFi() {
  const theme = useTheme();
  const { presentArticle } = useIntercom();
  const { data: shown } = useQuery<boolean>({ queryKey: ["settings", "defi-intro-shown"] });
  const { data: fundingConnected } = useQuery<boolean>({ queryKey: ["defi", "usdc-funding-connected"] });
  const { data: lifiConnected } = useQuery<boolean>({ queryKey: ["defi", "lifi-connected"] });
  const [fundingSheetOpen, setFundingSheetOpen] = useState(false);
  const [lifiSheetOpen, setLifiSheetOpen] = useState(false);
  const [disconnectLifi, setDisconnectLifi] = useState(false);
  const [disconnectFunding, setDisconnectFunding] = useState(false);
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <View fullScreen backgroundColor="$backgroundSoft">
        <ScrollView ref={defiScrollReference} showsVerticalScrollIndicator={false} flex={1}>
          <View backgroundColor="$backgroundSoft" padded>
            <YStack paddingBottom="$s3" gap="$s4_5">
              <XStack gap={10} justifyContent="space-between" alignItems="center">
                <Text fontSize={20} fontWeight="bold">
                  DeFi
                </Text>
                <Pressable
                  onPress={() => {
                    presentArticle("11731646").catch(reportError);
                  }}
                >
                  <CircleHelp color="$uiNeutralSecondary" />
                </Pressable>
              </XStack>
              <DeFiServiceButton
                title="USDC funding"
                description="Connect your wallet to Exactly Protocol"
                connected={fundingConnected ?? false}
                onPress={() => {
                  if (fundingConnected) {
                    router.push("/(app)/(home)/loans");
                  } else {
                    setFundingSheetOpen(true);
                  }
                }}
                onActionPress={() => {
                  setDisconnectFunding(true);
                }}
                icon={<ExactlyLogo width={24} height={24} fill={theme.interactiveOnBaseBrandSoft.val} />}
              />
              <DeFiServiceButton
                title="Swap tokens"
                description="Connect your wallet to Li.Fi"
                connected={lifiConnected ?? false}
                onPress={() => {
                  if (lifiConnected) {
                    router.push("/(app)/swaps");
                  } else {
                    setLifiSheetOpen(true);
                  }
                }}
                onActionPress={() => {
                  setDisconnectLifi(true);
                }}
                icon={<LiFiLogo width={24} height={24} fill={theme.interactiveOnBaseBrandSoft.val} />}
              />
            </YStack>
          </View>
        </ScrollView>
      </View>
      <IntroSheet
        open={Boolean(!shown)}
        onClose={() => {
          queryClient.setQueryData(["settings", "defi-intro-shown"], true);
        }}
      />
      <ConnectionSheet
        open={fundingSheetOpen}
        onClose={() => {
          setFundingSheetOpen(false);
        }}
        title="Connect to Exactly Protocol to access USDC funding"
        disclaimer={
          <Text color="$uiNeutralPlaceholder" caption2 textAlign="justify" flex={1}>
            USDC funding service provided by&nbsp;
            <Text
              color="$interactiveTextBrandDefault"
              caption2
              cursor="pointer"
              onPress={() => {
                openBrowserAsync(`https://exact.ly/`).catch(reportError);
              }}
            >
              Exactly Protocol
            </Text>
            , executed on decentralized networks. Pricing depends on network conditions and third-party protocols.
          </Text>
        }
        actionText="Connect wallet to Exactly Protocol"
        onActionPress={() => {
          setFundingSheetOpen(false);
          queryClient.setQueryData(["defi", "usdc-funding-connected"], true);
          router.push("/(app)/(home)/loans");
        }}
      />
      <ConnectionSheet
        open={lifiSheetOpen}
        onClose={() => {
          setLifiSheetOpen(false);
        }}
        title="Connect to Li.Fi to swap tokens"
        actionText="Connect wallet to Li.Fi"
        disclaimer={
          <Text color="$uiNeutralPlaceholder" caption2 textAlign="justify" flex={1}>
            Swap service provided by&nbsp;
            <Text
              color="$interactiveTextBrandDefault"
              caption2
              cursor="pointer"
              onPress={() => {
                openBrowserAsync(`https://li.fi/`).catch(reportError);
              }}
            >
              LI.FI
            </Text>
            , executed on decentralized networks. Availability and pricing depend on network conditions and third-party
            protocols.
          </Text>
        }
        onActionPress={() => {
          setLifiSheetOpen(false);
          queryClient.setQueryData(["defi", "lifi-connected"], true);
          router.push("/(app)/swaps");
        }}
      />
      <DisconnectSheet
        open={disconnectFunding}
        name="Exactly Protocol"
        onClose={() => {
          setDisconnectFunding(false);
        }}
        onActionPress={() => {
          setDisconnectFunding(false);
          queryClient.setQueryData(["defi", "usdc-funding-connected"], false);
        }}
      />
      <DisconnectSheet
        open={disconnectLifi}
        name="Li.Fi"
        onClose={() => {
          setDisconnectLifi(false);
        }}
        onActionPress={() => {
          setDisconnectLifi(false);
          queryClient.setQueryData(["defi", "lifi-connected"], false);
        }}
      />
    </SafeView>
  );
}

function DeFiServiceButton({
  title,
  description,
  connected,
  icon,
  onPress,
  onActionPress,
}: {
  title: string;
  description: string;
  connected: boolean;
  icon: React.ReactNode;
  onPress: () => void;
  onActionPress: () => void;
}) {
  return (
    <XStack
      borderWidth={1}
      borderColor="$borderNeutralSoft"
      borderRadius="$r4"
      alignItems="center"
      paddingHorizontal="$s4"
      paddingVertical="$s4_5"
      cursor="pointer"
      userSelect="none"
    >
      <XStack alignItems="center" gap="$s4" flex={1} onPress={onPress}>
        <XStack
          backgroundColor="$interactiveBaseBrandSoftDefault"
          width={40}
          height={40}
          borderRadius="$r3"
          alignItems="center"
          justifyContent="center"
        >
          {icon}
        </XStack>
        <YStack gap="$s1" flex={1}>
          <Text primary emphasized headline>
            {title}
          </Text>
          <Text secondary footnote>
            {description}
          </Text>
        </YStack>
        {!connected && <Link size="$iconSize.lg" strokeWidth="$iconStroke.lg" color="$iconBrandDefault" />}
      </XStack>
      {connected && (
        <XStack alignItems="center" justifyContent="flex-end" flex={0.5}>
          <Button danger minHeight={20} borderRadius="$r2" paddingHorizontal="$s2" onPress={onActionPress}>
            <Button.Text textTransform="uppercase" emphasized caption2 textAlign="center">
              Disconnect
            </Button.Text>
          </Button>
        </XStack>
      )}
    </XStack>
  );
}

export const defiScrollReference = React.createRef<ScrollView>();
export const defiRefreshControlReference = React.createRef<RefreshControl>();
