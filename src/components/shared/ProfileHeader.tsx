import { exaPreviewerAddress } from "@exactly/common/generated/chain";
import shortenHex from "@exactly/common/shortenHex";
import { Eye, EyeOff, Settings, ClockArrowUp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useNavigation } from "expo-router";
import React, { useState } from "react";
import { Pressable } from "react-native";
import { Image } from "tamagui";
import { zeroAddress } from "viem";
import { useAccount } from "wagmi";

import CopyAddressSheet from "./CopyAddressSheet";
import StatusIndicator from "./StatusIndicator";
import type { AppNavigationProperties } from "../../app/(app)/_layout";
import { useReadExaPreviewerPendingProposals } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ProfileHeader() {
  const { address, isConnected } = useAccount();
  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const navigation = useNavigation<AppNavigationProperties>("/(app)");
  const { data: pendingProposals, isFetching: pendingProposalsFetching } = useReadExaPreviewerPendingProposals({
    address: exaPreviewerAddress,
    args: [address ?? zeroAddress],
    query: { enabled: !!address, gcTime: 0, refetchInterval: 30_000 },
  });
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  function toggle() {
    queryClient.setQueryData(["settings", "sensitive"], !hidden);
  }
  function copy() {
    if (!address) return;
    setStringAsync(address).catch(reportError);
    setCopyAddressShown(true);
  }
  return (
    <View padded backgroundColor="$backgroundSoft">
      <View display="flex" flexDirection="row" justifyContent="space-between">
        <View display="flex" flexDirection="row" alignItems="center" gap={8}>
          <View position="relative">
            {isConnected && <StatusIndicator type="online" />}
            <Image
              source={{ uri: "https://avatars.githubusercontent.com/u/83888950?s=200&v=4" }}
              alt="Profile picture"
              width={32}
              height={32}
              borderRadius="$r_0"
            />
          </View>
          {address && (
            <Pressable onPress={copy} hitSlop={15}>
              <View display="flex" flexDirection="row" alignItems="flex-start">
                <Text fontSize={17} lineHeight={23} fontFamily="$mono">
                  {hidden ? "0x..." : shortenHex(address)}
                </Text>
              </View>
            </Pressable>
          )}
          <CopyAddressSheet
            open={copyAddressShown}
            onClose={() => {
              setCopyAddressShown(false);
            }}
          />
        </View>
        <View display="flex" flexDirection="row" alignItems="center" gap={16}>
          <Pressable onPress={toggle} hitSlop={15}>
            {hidden ? <EyeOff color="$uiNeutralSecondary" /> : <Eye color="$uiNeutralSecondary" />}
          </Pressable>
          {pendingProposals && pendingProposals.length > 0 && (
            <Pressable
              disabled={pendingProposalsFetching}
              onPress={() => {
                navigation.push("pending-proposals/index");
              }}
              hitSlop={15}
            >
              <StatusIndicator type="notification" />
              <ClockArrowUp color="$uiNeutralSecondary" />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              navigation.push("settings/index");
            }}
            hitSlop={15}
          >
            <Settings color="$uiNeutralSecondary" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}
