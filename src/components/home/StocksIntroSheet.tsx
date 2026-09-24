import React from "react";
import { useTranslation } from "react-i18next";

import { ArrowRight, X } from "@tamagui/lucide-icons";
import { YStack } from "tamagui";

import stocks from "../../assets/images/stocks.webp";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import IconButton from "../shared/IconButton";
import Image from "../shared/Image";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";
import View from "../shared/View";

export default function StocksIntroSheet({
  open,
  onClose,
  onActionPress,
}: {
  onActionPress: () => void;
  onClose: () => void;
  open: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} heightPercent={90}>
      <SafeView
        paddingTop={0}
        fullScreen
        borderTopLeftRadius="$r4"
        borderTopRightRadius="$r4"
        backgroundColor="$backgroundSoft"
      >
        <View fullScreen padded gap="$s4">
          <IconButton
            alignSelf="flex-end"
            icon={X}
            color="$uiNeutralSecondary"
            aria-label={t("Close")}
            onPress={onClose}
          />
          <YStack flex={1} alignItems="center" gap="$s9">
            <Image source={stocks} contentFit="contain" width="100%" maxWidth={296} aspectRatio={1} flexShrink={1} />
            <YStack alignItems="center" gap="$s5" maxWidth={300}>
              <Text
                pill
                caption2
                textTransform="uppercase"
                color="$interactiveOnBaseSuccessDefault"
                backgroundColor="$interactiveBaseSuccessDefault"
              >
                {t("NEW")} - {t("Tokenized stocks")}
              </Text>
              <YStack gap="$s4">
                <Text emphasized title centered>
                  {t("Invest in companies you know")}
                </Text>
                <Text callout secondary centered>
                  {t("Tesla, Apple, Meta and more, now available as tokenized stocks.")}
                </Text>
              </YStack>
            </YStack>
          </YStack>
          <YStack gap="$s5">
            <Button
              primary
              onPress={() => {
                onClose();
                onActionPress();
              }}
            >
              <Button.Text>{t("Start now")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
            <Text
              emphasized
              footnote
              brand
              centered
              cursor="pointer"
              onPress={() => {
                presentArticle("11757863").catch(reportError);
              }}
            >
              {t("Learn more")}
            </Text>
          </YStack>
        </View>
      </SafeView>
    </ModalSheet>
  );
}
