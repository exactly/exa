import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { useRouter } from "expo-router";

import { ClockArrowUp, Eye, EyeOff, Settings } from "@tamagui/lucide-icons";

import { useQuery } from "@tanstack/react-query";

import shortenHex from "@exactly/common/shortenHex";

import Blocky from "./Blocky";
import CopyAddressSheet from "./CopyAddressSheet";
import StatusIndicator from "./StatusIndicator";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePendingOperations from "../../utils/usePendingOperations";
import Text from "../shared/Text";
import View from "../shared/View";

export default function ProfileHeader() {
  const { t } = useTranslation();
  const { address } = useAccount();
  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const router = useRouter();
  const {
    count,
    proposals: { isFetching: pendingProposalsFetching },
  } = usePendingOperations();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  function toggle() {
    queryClient.setQueryData(["settings", "sensitive"], !hidden);
  }
  return (
    <View padded backgroundColor="$backgroundSoft">
      <View display="flex" flexDirection="row" justifyContent="space-between">
        <View display="flex" flexDirection="row" alignItems="center" gap="$s3">
          <View position="relative">
            {address && (
              <View borderRadius="$r_0" overflow="hidden">
                <Blocky seed={address} />
              </View>
            )}
          </View>
          {address && (
            <Pressable
              hitSlop={15}
              onPress={() => {
                setStringAsync(address).catch(reportError);
                setCopyAddressShown(true);
              }}
            >
              <View display="flex" flexDirection="row" alignItems="flex-start">
                <Text fontSize={17}>{hidden ? "0x..." : shortenHex(address)}</Text>
              </View>
            </Pressable>
          )}
        </View>
        <View display="flex" flexDirection="row" alignItems="center" gap="$s4">
          <Pressable aria-label={hidden ? t("Show sensitive") : t("Hide sensitive")} onPress={toggle} hitSlop={15}>
            {hidden ? <EyeOff color="$uiNeutralSecondary" /> : <Eye color="$uiNeutralSecondary" />}
          </Pressable>
          {count > 0 && (
            <Pressable
              aria-label={t("Pending proposals")}
              disabled={pendingProposalsFetching}
              onPress={() => {
                router.push("/pending-proposals");
              }}
              hitSlop={15}
            >
              <StatusIndicator type="notification" />
              <ClockArrowUp color="$uiNeutralSecondary" />
            </Pressable>
          )}
          <Pressable
            aria-label={t("Settings")}
            onPress={() => {
              router.push("/settings");
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
