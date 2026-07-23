import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { ThumbsUp } from "@tamagui/lucide-icons";
import { ScrollView, YStack } from "tamagui";

import { presentArticle } from "../../utils/intercom";
import reportError from "../../utils/reportError";
import ModalSheet from "../shared/ModalSheet";
import SafeView from "../shared/SafeView";
import Button from "../shared/StyledButton";
import Text from "../shared/Text";

export default function EducationSheet({
  article,
  children,
  onClose,
  open,
  title,
}: {
  article: string;
  children: React.ReactNode;
  onClose: () => void;
  open: boolean;
  title: string;
}) {
  const { t } = useTranslation();
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
              {title}
            </Text>
            {children}
            <Button primary width="100%" onPress={onClose}>
              <Button.Text adjustsFontSizeToFit={false}>{t("Got it!")}</Button.Text>
              <Button.Icon>
                <ThumbsUp />
              </Button.Icon>
            </Button>
            <Pressable
              onPress={() => {
                presentArticle(article).catch(reportError);
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
