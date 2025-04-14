import { exaPluginAddress } from "@exactly/common/generated/chain";
import { ArrowRight, Calendar, CirclePercent, Siren } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import { StyleSheet } from "react-native";
import { Separator, XStack, YStack } from "tamagui";
import { nonEmpty, pipe, safeParse, string } from "valibot";
import { zeroAddress } from "viem";
import { useAccount, useBytecode } from "wagmi";

import CalendarImage from "../../assets/images/calendar-rollover.svg";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "../../generated/contracts";
import queryClient from "../../utils/queryClient";
import Button from "../shared/Button";
import SafeView from "../shared/SafeView";
import Text from "../shared/Text";
import View from "../shared/View";

export default function RolloverIntro({ onClose }: { onClose: () => void }) {
  const toast = useToastController();

  const { maturity: currentMaturity } = useLocalSearchParams();
  const { success, output: maturity } = safeParse(pipe(string(), nonEmpty("no maturity")), currentMaturity);

  const { address } = useAccount();
  const { data: bytecode } = useBytecode({ address: address ?? zeroAddress, query: { enabled: !!address } });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    query: { refetchOnMount: true, enabled: !!address && !!bytecode },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;

  if (!success) return null;
  return (
    <SafeView
      paddingTop={0}
      fullScreen
      borderTopLeftRadius="$r4"
      borderTopRightRadius="$r4"
      backgroundColor="$backgroundMild"
    >
      <View aspectRatio={2} justifyContent="center" alignItems="center">
        <View width="100%" height="100%" style={StyleSheet.absoluteFillObject}>
          <CalendarImage width="100%" height="100%" />
        </View>
      </View>
      <Separator height={1} borderColor="$borderNeutralSoft" />
      <View padded paddingTop="$s6" fullScreen flex={1} backgroundColor="$backgroundMild">
        <YStack gap="$s7">
          <YStack gap="$s4_5">
            <Text primary emphasized title3>
              Refinance your debt
            </Text>
            <Text secondary subHeadline>
              Roll over your debt to avoid penalties and gain more time to repay. It’s a smart way to manage your cash
              flow and possibly reduce your rate.
            </Text>
          </YStack>
          <YStack gap="$s4">
            <XStack gap="$s3" alignItems="center" justifyContent="center">
              <Siren strokeWidth={2.5} color="$uiBrandSecondary" />
              <Text color="$uiBrandSecondary" emphasized headline>
                Avoid penalties by extending your deadline
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center" justifyContent="center">
              <CirclePercent strokeWidth={2.5} color="$uiBrandSecondary" />
              <Text color="$uiBrandSecondary" emphasized headline>
                Refinance at a better rate
              </Text>
            </XStack>
            <XStack gap="$s3" alignItems="center" justifyContent="center">
              <Calendar strokeWidth={2.5} color="$uiBrandSecondary" />
              <Text color="$uiBrandSecondary" emphasized headline>
                Get more time to repay
              </Text>
            </XStack>
          </YStack>
          <Button
            contained
            main
            spaced
            halfWidth
            iconAfter={<ArrowRight color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />}
            onPress={() => {
              if (!isLatestPlugin) {
                toast.show("Upgrade account to rollover", {
                  native: true,
                  duration: 1000,
                  burntOptions: { haptic: "error", preset: "error" },
                });
                return;
              }
              onClose();
              queryClient.setQueryData<boolean>(["settings", "rollover-intro-shown"], true);
              router.push({
                pathname: "/roll-debt",
                params: { maturity: maturity.toString() },
              });
            }}
          >
            Review refinance details
          </Button>
        </YStack>
      </View>
    </SafeView>
  );
}
