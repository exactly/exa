import React from "react";
import { Trans, useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ExternalLink, X } from "@tamagui/lucide-icons-2";
import { XStack, YStack } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import IconButton from "../shared/IconButton";
import ModalSheet from "../shared/ModalSheet";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function SpendingLimitSheet({ onClose, open }: { onClose: () => void; open: boolean }) {
  const { t } = useTranslation();
  return (
    <ModalSheet open={open} onClose={onClose} disableDrag>
      <YStack
        gap="$s7"
        borderTopLeftRadius="$r5"
        borderTopRightRadius="$r5"
        backgroundColor="$backgroundSoft"
        $platform-android={{ paddingBottom: "$s5" }}
      >
        <YStack gap="$s4" paddingTop="$s5" paddingHorizontal="$s5">
          <YStack gap="$s4">
            <XStack justifyContent="space-between" alignItems="center" gap="$s3">
              <Text emphasized headline flex={1}>
                {t("Spending limit")}
              </Text>
              <IconButton icon={X} aria-label={t("Close")} onPress={onClose} />
            </XStack>
            <YStack gap="$s4">
              <Text subHeadline secondary>
                <Trans
                  i18nKey="The maximum amount you can spend using <highlight>Pay Now</highlight>. Each purchase is deducted from your USDC balance immediately."
                  components={{ highlight: <Text subHeadline emphasized color="$cardDebitInteractive" /> }}
                />
              </Text>
              <Text subHeadline secondary>
                {t(
                  "If your balance doesn’t cover a transaction, other assets in your wallet can make up the difference.",
                )}
              </Text>
              <Text subHeadline secondary>
                {t("Any outstanding Pay Later balance also reduces your available spending limit.")}
              </Text>
            </YStack>
          </YStack>
        </YStack>
        <YStack gap="$s5" paddingHorizontal="$s4" paddingBottom="$s7">
          <Button
            onPress={() => {
              presentArticle("9922633").catch(reportError);
            }}
            primary
            width="100%"
          >
            <Button.Text>{t("Learn more")}</Button.Text>
            <Button.Icon>
              <ExternalLink />
            </Button.Icon>
          </Button>
          <Pressable onPress={onClose}>
            <Text emphasized footnote color="$interactiveBaseBrandDefault" alignSelf="center">
              {t("Close")}
            </Text>
          </Pressable>
        </YStack>
      </YStack>
    </ModalSheet>
  );
}
