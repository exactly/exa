import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight } from "@tamagui/lucide-icons";
import { useToastController } from "@tamagui/toast";
import { Spinner, YStack } from "tamagui";

import documents from "../../assets/images/documents.svg";
import { APIError } from "../../utils/queryClient";
import reportError from "../../utils/reportError";
import useBeginKYC from "../../utils/useBeginKYC";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import ThemedSvg from "../shared/ThemedSvg";
import View from "../shared/View";

export default function Intro() {
  const { t } = useTranslation();
  const toast = useToastController();
  const { mutate, isPending } = useBeginKYC();
  return (
    <SafeView fullScreen backgroundColor="$backgroundSoft">
      <View fullScreen padded gap="$s7">
        <YStack flex={1} justifyContent="center" gap="$s6">
          <View width="100%" aspectRatio={1} justifyContent="center" alignItems="center">
            <ThemedSvg xml={documents} width="100%" height="100%" />
          </View>
          <YStack gap="$s4" paddingHorizontal="$s4">
            <Text title emphasized textAlign="center" color="$interactiveTextBrandDefault">
              {t("Add your business details")}
            </Text>
            <Text footnote textAlign="center" color="$uiNeutralPlaceholder">
              {t("Your account is ready. We need a few details before you can start using it.")}
            </Text>
          </YStack>
        </YStack>
        <Button
          primary
          disabled={isPending}
          onPress={() => {
            mutate(undefined, {
              onError(error) {
                if (error instanceof APIError && error.code === 400) return;
                toast.show(t("Error verifying business"), {
                  duration: 1000,
                  burntOptions: { haptic: "error", preset: "error" },
                });
                reportError(error);
              },
            });
          }}
        >
          <Button.Text>{t("Continue")}</Button.Text>
          <Button.Icon>{isPending ? <Spinner color="$interactiveOnDisabled" /> : <ArrowRight />}</Button.Icon>
        </Button>
      </View>
    </SafeView>
  );
}
