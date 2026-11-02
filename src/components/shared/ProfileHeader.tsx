import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { setStringAsync } from "expo-clipboard";
import { useRouter } from "expo-router";

import { ClockArrowUp } from "@tamagui/lucide-icons-2/icons/ClockArrowUp";
import { Eye } from "@tamagui/lucide-icons-2/icons/Eye";
import { EyeOff } from "@tamagui/lucide-icons-2/icons/EyeOff";
import { Settings } from "@tamagui/lucide-icons-2/icons/Settings";
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
  const first = hidden ? undefined : card?.displayName?.split(" ")[0];
  const greeting = first
    ? t("Hi, {{name}}", { name: first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() })
    : [t("Good evening!"), t("Good morning!"), t("Good afternoon!"), t("Good evening!")][
        Number(hour >= 5) + Number(hour >= 12) + Number(hour >= 20)
      ];
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
            <Greeting key={greeting} text={greeting} />
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

function Greeting({ text }: { text?: string }) {
  const [natural, setNatural] = useState<number>();
  const [width, setWidth] = useState<number>();
  return (
    <View
      transition="quick"
      animateOnly={["opacity"]}
      enterStyle={{ opacity: 0 }}
      opacity={1}
      flexDirection="row"
      flexShrink={1}
      aria-hidden
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
    >
      <Text callout emphasized numberOfLines={1} opacity={0}>
        {text}
      </Text>
      <View position="absolute" onLayout={({ nativeEvent }) => setNatural(nativeEvent.layout.width)}>
        <Text
          callout
          emphasized
          whiteSpace="nowrap"
          transformOrigin="left"
          transform={[{ scale: natural && width ? width / natural : 1 }]}
        >
          {text}
        </Text>
      </View>
    </View>
  );
}
