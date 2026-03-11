import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";

import { useRouter } from "expo-router";

import { ArrowRight, Calendar, CirclePercent, Siren } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Separator, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import accountInit from "@exactly/common/accountInit";
import { exaPluginAddress } from "@exactly/common/generated/chain";
import { useReadUpgradeableModularAccountGetInstalledPlugins } from "@exactly/common/generated/hooks";

import CalendarImage from "../../assets/images/calendar-rollover.svg";
import queryClient from "../../utils/queryClient";
import useAccount from "../../utils/useAccount";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

import type { Credential } from "@exactly/common/validation";

export default function RolloverIntroSheet({ maturity, onClose }: { maturity?: string; onClose: () => void }) {
  const router = useRouter();
  const { address } = useAccount();
  const { t } = useTranslation();
  const toast = useToastController();
  const { data: credential } = useQuery<Credential>({ queryKey: ["credential"] });
  const { data: installedPlugins } = useReadUpgradeableModularAccountGetInstalledPlugins({
    address,
    factory: credential?.factory,
    factoryData: credential && accountInit(credential),
    query: { refetchOnMount: true, enabled: !!address && !!credential },
  });
  const isLatestPlugin = installedPlugins?.[0] === exaPluginAddress;
  const [open, setOpen] = useState(false);
  const [displayMaturity, setDisplayMaturity] = useState(maturity);

  if (maturity && !open) {
    setDisplayMaturity(maturity);
    setOpen(true);
  }

  const close = useCallback(() => {
    setOpen(false);
    onClose();
  }, [onClose]);

  const navigate = useCallback(() => {
    if (!isLatestPlugin) {
      toast.show(t("Upgrade account to rollover"), {
        native: true,
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
      return;
    }
    queryClient.setQueryData<boolean>(["settings", "rollover-intro-shown"], true);
    close();
    router.navigate({ pathname: "/roll-debt", params: { maturity: displayMaturity } });
  }, [isLatestPlugin, close, router, displayMaturity, toast, t]);

  return (
    <ModalSheet open={open} onClose={close}>
      <YStack
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        paddingTop="$s5"
        paddingBottom="$s7"
      >
        <View aspectRatio={2} justifyContent="center" alignItems="center">
          <View width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <CalendarImage width="100%" height="100%" />
          </View>
        </View>
        <Separator height={1} borderColor="$borderNeutralSoft" />
        <YStack paddingTop="$s6" paddingHorizontal="$s5" flex={1} backgroundColor="$backgroundMild">
          <YStack gap="$s7">
            <YStack gap="$s4_5">
              <Text primary emphasized title3>
                {t("Refinance your debt")}
              </Text>
              <Text secondary subHeadline>
                {t(
                  "Roll over your debt to avoid penalties and gain more time to repay. It's a smart way to manage your cash flow and possibly reduce your rate.",
                )}
              </Text>
            </YStack>
            <YStack gap="$s4">
              <XStack gap="$s3" alignItems="center" justifyContent="center">
                <Siren strokeWidth={2.5} color="$uiBrandSecondary" />
                <Text color="$uiBrandSecondary" emphasized subHeadline>
                  {t("Avoid penalties by extending your deadline")}
                </Text>
              </XStack>
              <XStack gap="$s3" alignItems="center" justifyContent="center">
                <CirclePercent strokeWidth={2.5} color="$uiBrandSecondary" />
                <Text color="$uiBrandSecondary" emphasized subHeadline>
                  {t("Refinance at a better rate")}
                </Text>
              </XStack>
              <XStack gap="$s3" alignItems="center" justifyContent="center">
                <Calendar strokeWidth={2.5} color="$uiBrandSecondary" />
                <Text color="$uiBrandSecondary" emphasized subHeadline>
                  {t("Get more time to repay")}
                </Text>
              </XStack>
            </YStack>
            <Button primary onPress={navigate}>
              <Button.Text>{t("Review refinance details")}</Button.Text>
              <Button.Icon>
                <ArrowRight color="$interactiveOnBaseBrandDefault" strokeWidth={2.5} />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
