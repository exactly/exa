import React from "react";
import { useTranslation } from "react-i18next";

import { Image } from "expo-image";

import { ArrowRight, X } from "@tamagui/lucide-icons";
import { View, XStack, YStack } from "tamagui";

import exaIntro from "../../assets/images/exa-intro.webp";
import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function PromoSheet({
  open,
  onClose,
  onActionPress,
}: {
  onActionPress: () => void;
  onClose: () => void;
  open: boolean;
}) {
  const {
    t,
    i18n: { language },
  } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <SafeView paddingTop={0} borderTopLeftRadius="$r4" borderTopRightRadius="$r4" backgroundColor="$backgroundSoft">
        <YStack>
          <View
            borderRadius="$r5"
            borderWidth={4}
            borderColor="$backgroundSoft"
            overflow="hidden"
            aspectRatio={195 / 112}
          >
            <Image source={exaIntro} style={{ width: "100%", height: "100%" }} contentFit="cover" />
            <View position="absolute" top="$s3" right="$s3">
              <IconButton icon={X} aria-label={t("Close")} onPress={onClose} color="white" />
            </View>
          </View>
        </YStack>
        <YStack gap="$s5" paddingVertical="$s5" paddingHorizontal="$s5">
          <YStack gap="$s5" alignItems="center" paddingHorizontal="$s6" paddingBottom="$s5">
            <XStack
              alignSelf="center"
              backgroundColor="$interactiveBaseSuccessDefault"
              minHeight={20}
              borderRadius="$r2"
              alignItems="center"
              justifyContent="center"
              paddingHorizontal="$s2"
            >
              <Text
                color="$interactiveOnBaseSuccessDefault"
                caption2
                textTransform="uppercase"
                emphasized
                textAlign="center"
              >
                {t("Limited-time offer")}
              </Text>
            </XStack>
            <Text emphasized title color="$interactiveTextBrandDefault" textAlign="center">
              {t("Pay Later at 0% interest")}
            </Text>
            <Text footnote secondary textAlign="center">
              {t(
                "Pay in 1, 2, or 3 installments at 0% interest on Exa Card purchases up to {{limit}}, through May. Interest is reimbursed in early June.",
                { limit: `$${(5000).toLocaleString(language, { maximumFractionDigits: 0 })}` },
              )}
            </Text>
          </YStack>
          <YStack gap="$s5">
            <Button
              onPress={() => {
                onClose();
                onActionPress();
              }}
              primary
            >
              <Button.Text>{t("Choose 0% installments")}</Button.Text>
              <Button.Icon>
                <ArrowRight />
              </Button.Icon>
            </Button>
            <Text
              cursor="pointer"
              onPress={() => {
                presentArticle("14424639").catch(reportError);
              }}
              emphasized
              footnote
              color="$interactiveBaseBrandDefault"
              textAlign="center"
            >
              {t("Learn more about the promo")}
            </Text>
          </YStack>
        </YStack>
      </SafeView>
    </ModalSheet>
  );
}
