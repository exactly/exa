import shortenHex from "@exactly/common/shortenHex";
import { Eye, EyeOff, Settings, ClockArrowUp } from "@tamagui/lucide-icons";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useNavigation } from "expo-router";
import React, { useState } from "react";
import { Pressable } from "react-native";
import { Image } from "tamagui";

import CopyAddressSheet from "./CopyAddressSheet";
import StatusIndicator from "./StatusIndicator";
import type { AppNavigationProperties } from "../../app/(main)/_layout";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePendingOperations from "../../utils/usePendingOperations";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ProfileHeader() {
  const { address, isConnected } = useAccount();
  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const navigation = useNavigation<AppNavigationProperties>("/(main)");
  const {
    count,
    proposals: { isFetching: pendingProposalsFetching },
  } = usePendingOperations();
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
        </View>
        <View display="flex" flexDirection="row" alignItems="center" gap={16}>
          <Pressable aria-label={hidden ? "Show sensitive" : "Hide sensitive"} onPress={toggle} hitSlop={15}>
            {hidden ? <EyeOff color="$uiNeutralSecondary" /> : <Eye color="$uiNeutralSecondary" />}
          </Pressable>
          {count > 0 && (
            <Pressable
              aria-label="Pending proposals"
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
            aria-label="Settings"
            onPress={() => {
              navigation.push("settings/index");
            }}
            hitSlop={15}
          >
            <Settings color="$uiNeutralSecondary" />
          </Pressable>
        </View>
      </View>
      <CopyAddressSheet
        open={copyAddressShown}
        onClose={() => {
          setCopyAddressShown(false);
        }}
      />
    </View>
  );
}
