import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { useRouter } from "expo-router";

import { ClockArrowUp, Eye, EyeOff, Settings } from "@tamagui/lucide-icons-2";
import { getTokens, useTheme } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import CopyAddressSheet from "./CopyAddressSheet";
import IconButton from "./IconButton";
import StatusIndicator from "./StatusIndicator";
import Logo from "../../assets/images/logo.svg";
import queryClient from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useAccount from "../../utils/useAccount";
import usePendingOperations from "../../utils/usePendingOperations";
import Text from "../shared/Text";
import View from "../shared/View";

import type { CardDetails } from "../../utils/server";

export default function ProfileHeader() {
  const { t } = useTranslation();
  const { address } = useAccount();
  const [copyAddressShown, setCopyAddressShown] = useState(false);
  const router = useRouter();
  const theme = useTheme();
  const {
    count,
    proposals: { isFetching: pendingProposalsFetching },
  } = usePendingOperations();
  const { data: hidden } = useQuery<boolean>({ queryKey: ["settings", "sensitive"] });
  const { data: card } = useQuery<CardDetails>({ queryKey: ["card", "details"] });
  const [hour, setHour] = useState(() => new Date().getHours());
  const [natural, setNatural] = useState<{ height: number; width: number }>();
  const [width, setWidth] = useState<number>();
  const first = hidden ? undefined : card?.displayName.split(" ")[0];
  const greeting = first
    ? t("Hi, {{name}}", { name: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() })
    : t(hour < 5 || hour >= 20 ? "Good evening!" : hour < 12 ? "Good morning!" : "Good afternoon!");
  useEffect(() => {
    if (first) return;
    const timer = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(timer);
  }, [first]);
  function toggle() {
    queryClient.setQueryData(["settings", "sensitive"], !hidden);
  }
  return (
    <View padded backgroundColor="$backgroundSoft">
      <View display="flex" flexDirection="row" justifyContent="space-between" gap="$s4">
        <Pressable
          hitSlop={15}
          style={{ flexShrink: 1 }}
          aria-label={greeting}
          disabled={!address}
          onPress={() => {
            if (!address) return;
            setStringAsync(address)
              .then(() => {
                setCopyAddressShown(true);
              })
              .catch(reportError);
          }}
        >
          <View display="flex" flexDirection="row" alignItems="center" gap="$s3">
            <View position="relative">
              <View
                width="$s6"
                height="$s6"
                borderRadius="$r_0"
                backgroundColor="$uiNeutralPrimary"
                alignItems="center"
                justifyContent="center"
              >
                <Logo
                  width={getTokens().iconSize.$sm.val}
                  height={getTokens().iconSize.$sm.val}
                  color={theme.backgroundSoft.val}
                />
              </View>
            </View>
            <View
              key={greeting}
              transition="quick"
              enterStyle={{ opacity: 0, transform: [{ translateY: 6 }] }}
              transform={[{ translateY: 0 }]}
              flexDirection="row"
              flexShrink={1}
              width={natural?.width}
              height={natural?.height}
              aria-hidden
              onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
            >
              <View position="absolute" onLayout={({ nativeEvent }) => setNatural(nativeEvent.layout)}>
                <Text
                  callout
                  emphasized
                  whiteSpace="nowrap"
                  transformOrigin="left"
                  transform={[{ scale: natural && width ? width / natural.width : 1 }]}
                >
                  {greeting}
                </Text>
              </View>
            </View>
          </View>
        </Pressable>
        <View display="flex" flexDirection="row" alignItems="center" gap="$s4">
          <IconButton
            icon={hidden ? EyeOff : Eye}
            color="$uiNeutralSecondary"
            aria-label={hidden ? t("Show sensitive") : t("Hide sensitive")}
            onPress={toggle}
          />
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
          <IconButton
            icon={Settings}
            color="$uiNeutralSecondary"
            aria-label={t("Settings")}
            onPress={() => {
              router.push("/settings");
            }}
          />
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
