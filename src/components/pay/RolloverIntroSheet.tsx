import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";

import { useRouter } from "expo-router";

import { ArrowRight } from "@tamagui/lucide-icons-2/icons/ArrowRight";
import { Calendar } from "@tamagui/lucide-icons-2/icons/Calendar";
import { CirclePercent } from "@tamagui/lucide-icons-2/icons/CirclePercent";
import { Siren } from "@tamagui/lucide-icons-2/icons/Siren";
import { useToastController } from "@tamagui/toast";
import { ScrollView, Separator, XStack, YStack } from "tamagui";

import calendarRollover from "../../assets/images/calendar-rollover.svg";
import queryClient from "../../utils/queryClient";
import useProposalManager from "../../utils/useProposalManager";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import ThemedSvg from "../shared/ThemedSvg";
import View from "../shared/View";

export default function RolloverIntroSheet({ maturity, onClose }: { maturity?: string; onClose: () => void }) {
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToastController();
  const proposalManager = useProposalManager();
  const [open, setOpen] = useState(false);
  const [displayMaturity, setDisplayMaturity] = useState(maturity);

  if (maturity) {
    if (maturity !== displayMaturity) setDisplayMaturity(maturity);
    if (!open) setOpen(true);
  }

  const close = useCallback(() => {
    setOpen(false);
    onClose();
  }, [onClose]);

  const navigate = useCallback(() => {
    if (!proposalManager) {
      toast.show(t("Upgrade account to rollover"), {
        duration: 1000,
        burntOptions: { haptic: "error", preset: "error" },
      });
      return;
    }
    queryClient.setQueryData<boolean>(["settings", "rollover-intro-shown"], true);
    close();
    router.navigate({ pathname: "/roll-debt", params: { maturity: displayMaturity } });
  }, [proposalManager, close, router, displayMaturity, toast, t]);

  return (
    <ModalSheet open={open} onClose={close}>
      <ScrollView $platform-web={{ maxHeight: "100vh" }}>
        <YStack
          borderTopLeftRadius="$r5"
          borderTopRightRadius="$r5"
          backgroundColor="$backgroundSoft"
          paddingTop="$s5"
          paddingBottom="$s7"
        >
          <View aspectRatio={2} justifyContent="center" alignItems="center">
            <View width="100%" height="100%" style={StyleSheet.absoluteFill}>
              <ThemedSvg xml={calendarRollover} width="100%" height="100%" />
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
                    "Roll over your debt to avoid penalties and gain more time to repay. It’s a smart way to manage your cash flow and possibly reduce your rate.",
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
                  <ArrowRight />
                </Button.Icon>
              </Button>
            </YStack>
          </YStack>
        </YStack>
      </ScrollView>
    </ModalSheet>
  );
}
