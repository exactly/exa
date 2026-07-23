import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { ScrollView, XStack, YStack } from "tamagui";

import chain from "@exactly/common/generated/chain";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import useMarkets from "../../utils/useMarkets";
import AssetLogo from "../shared/AssetLogo";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Skeleton from "../shared/Skeleton";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function CollateralSheet({ open, onClose }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  const { supportedAssets, isPending } = useMarkets();
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
              {t("Supported assets")}
            </Text>
            <XStack
              backgroundColor="$backgroundMild"
              borderRadius="$r4"
              padding="$s4_5"
              justifyContent="center"
              flexWrap="wrap"
              gap="$s3_5"
            >
              {isPending
                ? Array.from({ length: 5 }, (_, index) => (
                    <Skeleton key={index} height={40} width={40} radius="round" />
                  ))
                : supportedAssets.map((symbol) => <AssetLogo key={symbol} symbol={symbol} width={40} height={40} />)}
            </XStack>
            <Text subHeadline secondary>
              {t(
                "Only {{assets}} on {{chain}} serve as collateral, earn yield while held, and increase your Exa Card credit limit.",
                { assets: supportedAssets.join(", "), chain: chain.name },
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
                presentArticle("8950805").catch(reportError);
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
