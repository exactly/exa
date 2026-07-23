import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import { useQuery } from "@tanstack/react-query";

import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import { lifiChainsOptions } from "../../utils/lifi";
import reportError from "../../utils/reportError";
import ChainLogo from "../shared/ChainLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function NativeNetworkSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const { data: native } = useQuery({
    ...lifiChainsOptions,
    select: (chains) => chains.find((c) => c.id === chain.id),
  });
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <ScrollView showsVerticalScrollIndicator={false} $platform-web={{ maxHeight: "100vh" }}>
        <SafeView
          borderTopLeftRadius="$r4"
          borderTopRightRadius="$r4"
          backgroundColor="$backgroundSoft"
          paddingHorizontal="$s5"
          $platform-web={{ paddingVertical: "$s7" }}
          $platform-android={{ paddingBottom: "$s5" }}
        >
          <YStack gap="$s5">
            <Text emphasized primary headline>
              {t("Native network")}
            </Text>
            <XStack
              backgroundColor="$backgroundStrong"
              borderRadius="$r3"
              paddingVertical="$s5"
              paddingHorizontal="$s3_5"
              justifyContent="center"
              alignItems="center"
              gap="$s3"
            >
              <ChainLogo size={40} />
              <YStack>
                <Text emphasized title2 primary>
                  {native?.name ?? chain.name}
                </Text>
                <Text callout secondary>
                  {chain.name}
                </Text>
              </YStack>
            </XStack>
            <Text subHeadline secondary>
              {t(
                "{{chain}} is Exa App's native network. Supported assets received here generate yield and increase your Exa Card credit limit immediately. Other assets need to be swapped to a supported asset first.",
                { chain: chain.name },
              )}
            </Text>
            <Button primary width="100%" onPress={onClose}>
              <Button.Text adjustsFontSizeToFit={false}>{t("Got it!")}</Button.Text>
              <Button.Icon>
                <ThumbsUp />
              </Button.Icon>
            </Button>
            <Pressable
              onPress={() => {
                presentArticle("8950801").catch(reportError);
              }}
            >
              <Text emphasized footnote color="$uiBrandSecondary" centered>
                {t("Learn more")}
              </Text>
            </Pressable>
          </YStack>
        </SafeView>
      </ScrollView>
    </ModalSheet>
  );
}
