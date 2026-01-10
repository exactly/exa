import { CircleHelp, Link } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState, type RefObject } from "react";
import type { RefreshControl } from "react-native";
import { Pressable } from "react-native";
import { ScrollView, useTheme, XStack, YStack } from "tamagui";
import { zeroAddress } from "viem";
import { useBytecode } from "wagmi";

import AboutDefiSheet from "./AboutDefiSheet";
import ConnectionSheet from "./ConnectionSheet";
import DisconnectSheet from "./DisconnectSheet";
import IntroSheet from "./IntroSheet";
import ExactlyLogo from "../../assets/images/exactly.svg";
import LiFiLogo from "../../assets/images/lifi.svg";
import openBrowser from "../../utils/openBrowser";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";

export default function DeFi() {
  const theme = useTheme();
  const router = useRouter();
  const { data: shown } = useQuery<boolean>({ queryKey: ["settings", "defi-intro-shown"] });
  const { data: fundingConnected } = useQuery<boolean>({ queryKey: ["defi", "usdc-funding-connected"] });
  const { data: lifiConnected } = useQuery<boolean>({ queryKey: ["defi", "lifi-connected"] });
  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const [aboutDefiSheetOpen, setAboutDefiSheetOpen] = useState(false);
  const [fundingSheetOpen, setFundingSheetOpen] = useState(false);
  const [lifiSheetOpen, setLifiSheetOpen] = useState(false);
  const [disconnectLifi, setDisconnectLifi] = useState(false);
  const [disconnectFunding, setDisconnectFunding] = useState(false);
  return (
    <SafeView fullScreen tab backgroundColor="$backgroundSoft">
      <ScrollView ref={defiScrollReference} showsVerticalScrollIndicator={false} flex={1}>
        <YStack gap="$s4_5" paddingHorizontal="$s4" paddingVertical="$s3">
          <XStack justifyContent="space-between" alignItems="center">
            <Text emphasized title3>
              DeFi
            </Text>
            <Pressable
              onPress={() => {
                setAboutDefiSheetOpen(true);
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
                router.push("/loan");
              } else {
                setFundingSheetOpen(true);
              }
            }}
            onActionPress={() => {
              setDisconnectFunding(true);
            }}
            icon={<ExactlyLogo width={24} height={24} fill={theme.interactiveOnBaseBrandSoft.val} />}
          />
          {bytecode && (
            <DeFiServiceButton
              title="Swap tokens"
              description="Connect your wallet to LI.FI"
              connected={lifiConnected ?? false}
              onPress={() => {
                if (lifiConnected) {
                  router.push("/swaps");
                } else {
                  setLifiSheetOpen(true);
                }
              }}
              onActionPress={() => {
                setDisconnectLifi(true);
              }}
              icon={<LiFiLogo width={24} height={24} fill={theme.interactiveOnBaseBrandSoft.val} />}
            />
          )}
        </YStack>
      </ScrollView>
      <IntroSheet
        open={!shown}
        onClose={() => {
          queryClient.setQueryData(["settings", "defi-intro-shown"], true);
        }}
      />
      <AboutDefiSheet
        open={aboutDefiSheetOpen}
        onClose={() => {
          setAboutDefiSheetOpen(false);
        }}
      />
      <ConnectionSheet
        open={fundingSheetOpen}
        onClose={() => {
          setFundingSheetOpen(false);
        }}
        title="Connect to Exactly Protocol to access USDC funding"
        disclaimer={
          <Text color="$uiNeutralPlaceholder" caption2 flex={1}>
            USDC funding service provided by&nbsp;
            <Text
              color="$interactiveTextBrandDefault"
              caption2
              cursor="pointer"
              onPress={() => {
                openBrowser("https://exact.ly/").catch(reportError);
              }}
            >
              Exactly Protocol
            </Text>
            , executed on decentralized networks. Pricing depends on network conditions and third-party protocols.
          </Text>
        }
        terms={
          <XStack alignItems="center" cursor="pointer">
            <Text caption secondary>
              Accept Exactly Protocol&apos;s&nbsp;
              <Text
                color="$interactiveTextBrandDefault"
                onPress={() => {
                  openBrowser("https://docs.exact.ly/legal/terms-and-conditions-of-use").catch(reportError);
                }}
              >
                terms & conditions
              </Text>
            </Text>
          </XStack>
        }
        actionText="Connect wallet to Exactly Protocol"
        onActionPress={() => {
          setFundingSheetOpen(false);
          queryClient.setQueryData(["defi", "usdc-funding-connected"], true);
          router.push("/loan");
        }}
      />
      <ConnectionSheet
        open={lifiSheetOpen}
        onClose={() => {
          setLifiSheetOpen(false);
        }}
        title="Connect to LI.FI to swap tokens"
        actionText="Connect wallet to LI.FI"
        disclaimer={
          <Text color="$uiNeutralPlaceholder" caption2 flex={1}>
            Swap service provided by&nbsp;
            <Text
              color="$interactiveTextBrandDefault"
              caption2
              cursor="pointer"
              onPress={() => {
                openBrowser("https://li.fi/").catch(reportError);
              }}
            >
              LI.FI
            </Text>
            , executed on decentralized networks. Availability and pricing depend on network conditions and third-party
            protocols.
          </Text>
        }
        terms={
          <XStack alignItems="center" cursor="pointer">
            <Text caption secondary>
              Accept LI.FI&apos;s&nbsp;
              <Text
                color="$interactiveTextBrandDefault"
                onPress={() => {
                  openBrowser("https://li.fi/legal/terms-and-conditions/").catch(reportError);
                }}
              >
                terms & conditions
              </Text>
            </Text>
          </XStack>
        }
        onActionPress={() => {
          setLifiSheetOpen(false);
          queryClient.setQueryData(["defi", "lifi-connected"], true);
          router.push("/swaps");
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
        name="LI.FI"
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
      justifyContent="space-between"
      gap="$s3"
    >
      <XStack alignItems="center" gap="$s4" onPress={onPress} flex={3}>
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
      </XStack>
      <XStack onPress={connected ? onActionPress : onPress} justifyContent="flex-end" alignItems="center">
        {connected ? (
          <XStack
            backgroundColor="$interactiveBaseErrorDefault"
            minHeight={20}
            borderRadius="$r2"
            alignItems="center"
            justifyContent="center"
            paddingHorizontal="$s2"
          >
            <Text
              color="$interactiveOnBaseErrorDefault"
              caption2
              textTransform="uppercase"
              emphasized
              textAlign="center"
            >
              Disconnect
            </Text>
          </XStack>
        ) : (
          <Link size="$iconSize.lg" strokeWidth="$iconStroke.lg" color="$iconBrandDefault" />
        )}
      </XStack>
    </XStack>
  );
}

export const defiScrollReference: RefObject<ScrollView | null> = { current: null };
export const defiRefreshControlReference: RefObject<RefreshControl | null> = { current: null };
