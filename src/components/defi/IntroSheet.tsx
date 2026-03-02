import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ArrowRight, Info, X } from "@tamagui/lucide-icons";
import { XStack, YStack } from "tamagui";

import Defi from "../../assets/images/defi.svg";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function IntroSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag heightPercent={90}>
      <SafeView
        paddingTop={0}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <View position="absolute" top="$s5" right="$s5" zIndex={100_000}>
          <Pressable onPress={onClose} hitSlop={15}>
            <X size={25} color="$uiNeutralSecondary" />
          </Pressable>
        </View>
        <YStack flex={1} padding="$s4" gap="$s4_5">
          <YStack flex={1} gap="$s4">
            <View flex={1} width="100%">
              <Defi width="100%" height="100%" />
            </View>
            <YStack gap="$s4" alignSelf="center">
              <Text
                emphasized
                textAlign="center"
                color="$interactiveTextBrandDefault"
                title
                adjustsFontSizeToFit
                numberOfLines={1}
              >
                {t("Welcome to DeFi")}
              </Text>
              <Text color="$uiNeutralPlaceholder" footnote textAlign="center" adjustsFontSizeToFit numberOfLines={2}>
                {t("Access decentralized services provided by third-party DeFi protocols.")}
              </Text>
            </YStack>
          </YStack>
          <YStack gap="$s4_5">
            <XStack alignItems="center" gap="$s4">
              <XStack>
                <Info size="$iconSize.md" strokeWidth="$iconStroke.md" color="$uiInfoSecondary" />
              </XStack>
              <Text color="$uiNeutralPlaceholder" caption2 textAlign="justify" flex={1}>
                <Trans
                  i18nKey="Exa App does not control your assets or provide financial services. All integrations are powered by independent third-party DeFi protocols. <link>Learn more about how to connect your wallet to DeFi.</link>"
                  components={{
                    link: (
                      <Text
                        color="$interactiveTextBrandDefault"
                        caption2
                        cursor="pointer"
                        onPress={() => {
                          presentArticle("11731646").catch(reportError);
                        }}
                      />
                    ),
                  }}
                />
              </Text>
            </XStack>
            <Button onPress={onClose} primary>
              <Button.Text>{t("Explore decentralized services")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
